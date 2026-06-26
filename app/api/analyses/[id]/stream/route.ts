import { NextRequest } from "next/server";
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
        const p1 = currentAnalysis.phase1Result || {};
        const p2 = currentAnalysis.phase2Result || {};
        const p3 = currentAnalysis.phase3Result || {};
        const searches = (p1.web_searches_performed || 0) + (p2.web_searches_performed || 0) + (p3.web_searches_performed || 0);

        if (currentAnalysis.phase1Result) {
          sendEvent({ type: "phase_complete", phase: 1, result: p1, total_searches: searches });
        }
        if (currentAnalysis.phase2Result) {
          sendEvent({ type: "phase_complete", phase: 2, result: p2, total_searches: searches });
        }
        if (currentAnalysis.phase3Result) {
          sendEvent({ type: "phase_complete", phase: 3, result: p3, total_searches: searches });
        }
        
        sendEvent({
          type: "analysis_complete",
          phase: 3,
          label: "Synthesizing market analysis & strategic recommendations",
          total_searches: searches,
          duration_ms: currentAnalysis.durationMs || 0,
          result: {
            phase1: p1,
            phase2: p2,
            phase3: p3,
            totalSearches: searches
          }
        });
        
        try { controller.close(); } catch (e) {}
        return;
      } else if (currentAnalysis.status === "FAILED") {
        sendEvent({ type: "error", message: currentAnalysis.errorMessage || "Analysis failed" });
        try { controller.close(); } catch (e) {}
        return;
      }

      // Stream already completed phases first for a reconnecting client
      const p1 = currentAnalysis.phase1Result;
      const p2 = currentAnalysis.phase2Result;
      const p3 = currentAnalysis.phase3Result;
      const searches = (p1?.web_searches_performed || 0) + (p2?.web_searches_performed || 0) + (p3?.web_searches_performed || 0);

      if (currentAnalysis.phase >= 1 && p1) {
        sendEvent({ type: "phase_complete", phase: 1, result: p1, total_searches: searches });
      }
      if (currentAnalysis.phase >= 2 && p2) {
        sendEvent({ type: "phase_complete", phase: 2, result: p2, total_searches: searches });
      }
      if (currentAnalysis.phase >= 3 && p3) {
        sendEvent({ type: "phase_complete", phase: 3, result: p3, total_searches: searches });
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
