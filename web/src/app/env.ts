// Optional settings injected at build time (vite.config.ts) from the deploy workflow's repository
// variables. Both are empty in local and CI builds, which turns the features off.
declare const __FEEDBACK_EMAIL__: string;
declare const __GOATCOUNTER_CODE__: string;

/** Address the feedback links write to; empty means GitHub issues only. */
export const FEEDBACK_EMAIL = __FEEDBACK_EMAIL__;
/** GoatCounter site code (`<code>.goatcounter.com`); empty means nothing is counted. */
export const GOATCOUNTER_CODE = __GOATCOUNTER_CODE__;
