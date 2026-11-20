// Optional settings injected at build time (vite.config.ts) from the deploy workflow's repository
// variables. All are empty in local and CI builds, which turns the features off.
declare const __FEEDBACK_EMAIL__: string;
declare const __FEEDBACK_FORM_URL__: string;
declare const __IDEAS_URL__: string;
declare const __GOATCOUNTER_CODE__: string;

/** Address the feedback links write to; empty means GitHub issues only. */
export const FEEDBACK_EMAIL = __FEEDBACK_EMAIL__;
/** Form for problem reports (e.g. Tally), opened with the version, view and device as URL parameters. */
export const FEEDBACK_FORM_URL = __FEEDBACK_FORM_URL__;
/** Public board where people post ideas and vote on them. */
export const IDEAS_URL = __IDEAS_URL__;
/** GoatCounter site code (`<code>.goatcounter.com`); empty means nothing is counted. */
export const GOATCOUNTER_CODE = __GOATCOUNTER_CODE__;
