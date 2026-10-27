import { WorkerEntrypoint } from "cloudflare:workers";
import coreWorker from "./index.js";
import { resolvePartnerOperationalDays } from "./repositories/partner-operational-days.js";
import { handleDayAuditRequest, isDayAuditRequest } from "./day-audit-http.js";
import { handlePaymentCorrectionReviewRequest, isPaymentCorrectionReviewRequest } from "./payment-correction-review-http.js";

export class PartnerSchedulingEntrypoint extends WorkerEntrypoint {
  async resolveOperationalDays(payload = {}) {
    return resolvePartnerOperationalDays(
      this.env.CORE_DB,
      String(payload.salonId || this.env.SALON_ID || "main").trim() || "main",
      payload
    );
  }
}

export default {
  async fetch(request, env, executionCtx) {
    if (isDayAuditRequest(request)) {
      return handleDayAuditRequest(request, env);
    }
    if (isPaymentCorrectionReviewRequest(request)) {
      return handlePaymentCorrectionReviewRequest(request, env);
    }
    return coreWorker.fetch(request, env, executionCtx);
  },
  async scheduled(event, env, ctx) {
    return coreWorker.scheduled(event, env, ctx);
  },
};
