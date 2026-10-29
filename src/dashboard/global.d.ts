// Minilytics tracker (only present on minilytics.app; always call with optional chaining).
interface Window {
  minilytics?: ((cmd: 'goal' | 'identify' | 'pageview', a?: any, b?: any) => void) & {
    q?: unknown[];
    attribution?: () => { ml_visitor_id?: string; ml_session_id?: string };
  };
}
