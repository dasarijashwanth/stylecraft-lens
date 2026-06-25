import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { memoryDb } from "@/lib/memoryDb";
import { analysisEvents } from "@/lib/analysisEngine";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id: analysisId } = params;
  
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      
      const sendEvent = (eventData: any) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(eventData)}\n\n`));
        } catch (e) {
          // Stream might have already been closed
        }
      };

      // Fetch the current state of this analysis
      let currentAnalysis: any = null;
      try {
        currentAnalysis = await prisma.analysis.findUnique({ where: { id: analysisId } });
      } catch (e) {
        currentAnalysis = memoryDb.analyses.find(a => a.id === analysisId);
      }

      if (!currentAnalysis) {
        sendEvent({ type: "error", message: "Analysis record not found" });
        try { controller.close(); } catch (e) {}
        return;
      }

      // If it is already finished, stream past completion events immediately and close
      if (currentAnalysis.status === "COMPLETE") {
        if (currentAnalysis.phase1Result) {
          sendEvent({ type: "phase_complete", phase: 1, result: currentAnalysis.phase1Result });
        }
        if (currentAnalysis.phase2Result) {
          sendEvent({ type: "phase_complete", phase: 2, result: currentAnalysis.phase2Result });
        }
        if (currentAnalysis.phase3Result) {
          sendEvent({ type: "phase_complete", phase: 3, result: currentAnalysis.phase3Result });
        }
        sendEvent({
          type: "analysis_complete",
          phase: 4,
          message: "Analysis already completed",
          result: { duration: currentAnalysis.durationMs || 0, analysisId }
        });
        try { controller.close(); } catch (e) {}
        return;
      } else if (currentAnalysis.status === "FAILED") {
        sendEvent({ type: "error", message: currentAnalysis.errorMessage || "Analysis failed" });
        try { controller.close(); } catch (e) {}
        return;
      }

      // Stream already completed phases first for a reconnecting client
      if (currentAnalysis.phase >= 1 && currentAnalysis.phase1Result) {
        sendEvent({ type: "phase_complete", phase: 1, result: currentAnalysis.phase1Result });
      }
      if (currentAnalysis.phase >= 2 && currentAnalysis.phase2Result) {
        sendEvent({ type: "phase_complete", phase: 2, result: currentAnalysis.phase2Result });
      }
      if (currentAnalysis.phase >= 3 && currentAnalysis.phase3Result) {
        sendEvent({ type: "phase_complete", phase: 3, result: currentAnalysis.phase3Result });
      }

      // Define listener for background events
      const onProgress = (data: any) => {
        sendEvent(data);
        if (data.type === "analysis_complete" || data.type === "error") {
          cleanup();
          try { controller.close(); } catch (e) {}
        }
      };

      analysisEvents.on(`progress:${analysisId}`, onProgress);

      const cleanup = () => {
        analysisEvents.off(`progress:${analysisId}`, onProgress);
      };

      // Keepalive connection ping (prevents cloud proxy timeouts)
      const keepAliveInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch (e) {
          cleanup();
          clearInterval(keepAliveInterval);
        }
      }, 15000);

      // Handle client abort / disconnect
      request.signal.addEventListener("abort", () => {
        cleanup();
        clearInterval(keepAliveInterval);
        try { controller.close(); } catch (e) {}
      });
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
