use axum::{
    body::Body,
    http::{Response, StatusCode, header},
    response::{Html, IntoResponse},
};

const APPLICATION_JAVASCRIPT: &str = include_str!(concat!(env!("OUT_DIR"), "/app.js"));
const APPLICATION_CSS: &str = include_str!(concat!(env!("OUT_DIR"), "/app.css"));

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
      const mountNode = document.getElementById("root");
      Elm.Main.init({ node: mountNode });

      let viewportScrollRegionFrame;
      const sizeViewportScrollRegions = () => {
        viewportScrollRegionFrame = undefined;
        document.querySelectorAll("[data-viewport-scroll-region]").forEach((region) => {
          const visibleTop = Math.max(0, region.getBoundingClientRect().top);
          region.style.setProperty("--viewport-scroll-region-top", `${visibleTop}px`);
        });
      };
      const scheduleViewportScrollRegionSize = () => {
        if (viewportScrollRegionFrame === undefined) {
          viewportScrollRegionFrame = requestAnimationFrame(sizeViewportScrollRegions);
        }
      };

      addEventListener("scroll", scheduleViewportScrollRegionSize, { passive: true });
      addEventListener("resize", scheduleViewportScrollRegionSize, { passive: true });
      new MutationObserver(scheduleViewportScrollRegionSize).observe(document.body, {
        childList: true,
        subtree: true,
      });
      scheduleViewportScrollRegionSize();
    </script>
  </body>
</html>
"#;

pub async fn index() -> Html<&'static str> {
    Html(INDEX)
}

pub async fn javascript() -> impl IntoResponse {
    asset("text/javascript; charset=utf-8", APPLICATION_JAVASCRIPT)
}

pub async fn stylesheet() -> impl IntoResponse {
    asset("text/css; charset=utf-8", APPLICATION_CSS)
}

fn asset(content_type: &'static str, content: &'static str) -> Response<Body> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from(content))
        .expect("static asset response is valid")
}

#[cfg(test)]
mod tests {
    use super::{APPLICATION_CSS, APPLICATION_JAVASCRIPT, INDEX};

    #[test]
    fn embeds_compiled_elm_application() {
        assert!(APPLICATION_JAVASCRIPT.contains("Elm.Main.init"));
        assert!(APPLICATION_CSS.contains(".app-bar"));
        assert!(INDEX.contains("/assets/app.js"));
        assert!(INDEX.contains("/assets/app.css"));
    }
}
