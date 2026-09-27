// Types for the Holt HTTP API (API.md). The shapes come from the server's
// pydantic models via ./api-schema.ts, which is generated: change the server
// (server/holt_server/schema.py) and run server/scripts/api_types.sh.
import type * as S from "./api-schema";

export type Report = S.Report;
export type Stats = S.Stats;
export type LandingPath = S.LandingPath;
export type EvidenceItem = S.EvidenceItem;
export type Odds = S.Odds;
export type StarterIssue = S.StarterIssue;
export type FindResult = S.FindResult;
// The web always sends every field; the server has defaults for them.
export type FindQuery = Required<S.FindIn>;
export type JobStatus = S.JobStatus;
export type FindJobStatus = S.FindJobStatus;
export type Me = S.Me;
export type HistoryItem = S.HistoryItem;
export type GitHubConnection = S.GitHubConnection;
export type ApiError = S.Error;

export type Mode = Report["mode"];
export type Verdict = Report["verdict"];
/** The colour of a verdict or of the odds, chosen by the server. */
export type Tone = Report["tone"];
export type ApiErrorCode = ApiError["code"];
export type ByokProvider = S.Byok["provider"];

export type AnalysisStart = S.AnalysisDone | S.Queued;
export type FindStart = S.FindDone | S.Queued;

/** Result of a call: either data or a plain-English error. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError; status: number };
