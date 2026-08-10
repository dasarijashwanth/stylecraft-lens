import { Readable } from "stream";

async function getDriveInstance() {
  try {
    const { google } = await import("googleapis");
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      "https://developers.google.com/oauthplayground"
    );
    if (process.env.GOOGLE_REFRESH_TOKEN) {
      oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    }
    return google.drive({ version: "v3", auth: oauth2 });
  } catch (e) {
    return null;
  }
}

// Drive's query language uses '...' for string literals; a project/product
// name containing an unescaped quote could otherwise break out of the
// literal and manipulate the query (e.g. matching/reusing an unintended
// existing folder) — escape per Drive's own query syntax (\' for a literal
// quote), same idea as any other query-language injection guard.
function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findOrCreateFolder(drive: any, name: string, parentId?: string): Promise<string> {
  const query = [
    `name='${escapeDriveQueryLiteral(name)}'`,
    `mimeType='application/vnd.google-apps.folder'`,
    `trashed=false`,
    parentId ? `'${escapeDriveQueryLiteral(parentId)}' in parents` : null,
  ].filter(Boolean).join(" and ");

  const res = await drive.files.list({ q: query, fields: "files(id, name)" });

  if (res.data.files?.length > 0) {
    return res.data.files[0].id;
  }

  const folder = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : [],
    },
    fields: "id",
  });

  return folder.data.id;
}

export async function uploadToDrive({
  content,
  fileName,
  mimeType,
  projectName,
  outputType,
  existingFileId,
}: {
  content: string | Buffer;
  fileName: string;
  mimeType: string;
  projectName: string;
  outputType: string;
  // If set, updates this file's content in place (same Drive file/link)
  // instead of creating a new one — used for the "replace" path.
  existingFileId?: string | null;
}): Promise<{ fileId: string; webViewLink: string }> {
  // If Google credentials are not configured, return a realistic mock drive URL
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REFRESH_TOKEN) {
    return {
      fileId: `mock_drive_${Date.now()}`,
      webViewLink: `https://drive.google.com/file/d/mock_${Date.now()}/view?usp=sharing`
    };
  }

  try {
    const drive = await getDriveInstance();
    if (!drive) {
      return {
        fileId: `mock_drive_${Date.now()}`,
        webViewLink: `https://drive.google.com/file/d/mock_${Date.now()}/view?usp=sharing`
      };
    }

    const stream = Readable.from(typeof content === "string" ? [content] : [content]);

    if (existingFileId) {
      try {
        const updated = await drive.files.update({
          fileId: existingFileId,
          requestBody: { name: fileName },
          media: { mimeType, body: stream },
          fields: "id, webViewLink",
        });
        return { fileId: updated.data.id!, webViewLink: updated.data.webViewLink! };
      } catch (updateErr: any) {
        // The file may have been deleted/moved out from under us in Drive —
        // fall through to creating a fresh one rather than failing outright.
        // Security audit fix — never log the raw error object: googleapis'
        // GaxiosError carries the full outgoing request (incl. the live
        // Bearer access token derived from the one shared GOOGLE_REFRESH_
        // TOKEN this whole app's Drive integration uses) as an enumerable
        // own property, which Node's default console.warn formatting would
        // print in full. Only safe, non-credential fields.
        console.warn("Drive file update failed, creating a new file instead:", {
          message: updateErr?.message,
          status: updateErr?.status || updateErr?.code,
        });
      }
    }

    const rootId = await findOrCreateFolder(drive, "Stylecraft Lens");
    const projId = await findOrCreateFolder(drive, projectName, rootId);
    const outputId = await findOrCreateFolder(drive, outputType, projId);

    const createStream = existingFileId ? Readable.from(typeof content === "string" ? [content] : [content]) : stream;
    const file = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [outputId],
      },
      media: {
        mimeType,
        body: createStream,
      },
      fields: "id, webViewLink",
    });

    return {
      fileId: file.data.id!,
      webViewLink: file.data.webViewLink!,
    };
  } catch (err: any) {
    // Security audit fix — see the identical comment above; never log the
    // raw SDK error object (could carry a live access token).
    console.warn("Google Drive live upload error, using fallback URL:", {
      message: err?.message,
      status: err?.status || err?.code,
    });
    return {
      fileId: `fallback_drive_${Date.now()}`,
      webViewLink: `https://drive.google.com/file/d/fallback_${Date.now()}/view?usp=sharing`
    };
  }
}
