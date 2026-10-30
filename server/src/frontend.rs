use axum::{
    http::header,
    response::{Html, IntoResponse},
};

const APPLICATION_JAVASCRIPT: &str = include_str!(concat!(env!("OUT_DIR"), "/app.js"));
const APPLICATION_CSS: &str = include_str!(concat!(env!("OUT_DIR"), "/app.css"));
const VIEWPORT_JAVASCRIPT: &str = include_str!("../../elm/viewport.js");
const TIME_JAVASCRIPT: &str = include_str!("../../elm/time.js");

const INDEX: &str = r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="A fast semantic diff workspace for reviewing pull requests and agent-written code.">
    <link rel="stylesheet" href="/assets/app.css">
    <title>Hunker — review the change, not the noise</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="/assets/app.js"></script>
    <script>
      Elm.Main.init({ node: document.getElementById("root") });
    </script>
    <script src="/assets/viewport.js"></script>
    <script src="/assets/time.js"></script>
  </body>
</html>
"#;

pub async fn index() -> Html<&'static str> {
    Html(INDEX)
}

pub async fn javascript() -> impl IntoResponse {
    asset("text/javascript; charset=utf-8", APPLICATION_JAVASCRIPT)
}

pub async fn viewport() -> impl IntoResponse {
    asset("text/javascript; charset=utf-8", VIEWPORT_JAVASCRIPT)
}

pub async fn time() -> impl IntoResponse {
    asset("text/javascript; charset=utf-8", TIME_JAVASCRIPT)
}

pub async fn stylesheet() -> impl IntoResponse {
    asset("text/css; charset=utf-8", APPLICATION_CSS)
}

fn asset(content_type: &'static str, content: &'static str) -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        content,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        APPLICATION_CSS, APPLICATION_JAVASCRIPT, INDEX, TIME_JAVASCRIPT, VIEWPORT_JAVASCRIPT,
    };

    #[test]
    fn embeds_compiled_elm_application() {
        assert!(APPLICATION_JAVASCRIPT.contains("Elm.Main.init"));
        assert!(APPLICATION_CSS.contains(".app-bar"));
        assert!(INDEX.contains("/assets/app.js"));
        assert!(INDEX.contains("/assets/app.css"));
        assert!(INDEX.contains("/assets/viewport.js"));
        assert!(VIEWPORT_JAVASCRIPT.contains("--viewport-scroll-region-top"));
        assert!(INDEX.contains("/assets/time.js"));
        assert!(TIME_JAVASCRIPT.contains(r#"customElements.define("hunker-time""#));
    }
}
