import { Submodel } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

const utilities: Readonly<Record<string, string>> = {
  "app-shell": "min-h-screen bg-canvas review-grid",
  topbar:
    "sticky top-0 z-20 grid min-h-[68px] grid-cols-[minmax(260px,1fr)_minmax(400px,680px)_auto_minmax(160px,1fr)] items-center gap-3 bg-ink px-7 py-3 text-white shadow-[0_6px_22px_rgb(16_27_44/16%)] max-[1040px]:grid-cols-[auto_minmax(340px,1fr)_auto] max-[1040px]:[&_.shortcut-hint]:hidden max-[760px]:static max-[760px]:grid-cols-[1fr_auto] max-[760px]:gap-2.5 max-[760px]:px-4 max-[760px]:py-[13px] max-[760px]:[&_.pr-loader]:order-3 max-[760px]:[&_.pr-loader]:col-span-2",
  "compact-review-toolbar":
    "sticky top-0 z-30 flex h-[68px] items-center gap-3 border-b border-[#3b4659] bg-ink px-4 text-white shadow-[0_5px_18px_rgb(16_27_44/18%)] transition-[height] duration-150 [&.is-compact]:h-12 [&.is-expanded_.brand-mark]:size-[34px] [&.is-expanded_.brand-name]:text-xl [&.is-expanded_.toolbar-review-identity_>strong]:text-xs [&.is-expanded_.toolbar-review-identity_>span]:text-[10px] max-[760px]:gap-2 max-[760px]:px-2.5",
  "compact-brand":
    "flex shrink-0 items-center gap-2 text-white no-underline [&_.brand-mark]:size-7 [&_.brand-mark]:text-[12px] [&_.brand-name]:text-base max-[920px]:[&_.brand-name]:hidden",
  "toolbar-review-identity":
    "flex min-w-0 flex-1 flex-col text-white no-underline [&_strong]:overflow-hidden [&_strong]:text-[10px] [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&_span]:overflow-hidden [&_span]:text-[9px] [&_span]:text-[#aeb6be] [&_span]:text-ellipsis [&_span]:whitespace-nowrap max-[1080px]:max-w-[180px] max-[1080px]:[&_span]:hidden max-[680px]:hidden",
  "toolbar-primary-controls":
    "flex shrink-0 items-center gap-1.5 [&_.segmented]:bg-[#303b50] [&_.segmented-button]:px-2.5 [&_.segmented-button]:py-1.5 [&_.segmented-button]:text-[10px] [&_.segmented-button]:text-[#b9c0cb] [&_.segmented-button.is-active]:bg-[#f7f7f3] [&_.segmented-button.is-active]:text-ink max-[760px]:[&_.segmented-button]:px-2",
  "toolbar-actions": "ml-auto flex shrink-0 items-center gap-1.5",
  "review-tab-picker":
    "shrink-0 bg-[#303b50] [&_.segmented-button]:px-2.5 [&_.segmented-button]:py-1.5 [&_.segmented-button]:text-[10px] [&_.segmented-button]:text-[#b9c0cb] [&_.segmented-button.is-active]:bg-[#f7f7f3] [&_.segmented-button.is-active]:text-ink max-[760px]:[&_.segmented-button]:px-2",
  "toolbar-menu":
    "relative z-50 [&.is-open>.toolbar-menu-button]:border-[#aebc78] [&.is-open>.toolbar-menu-button]:bg-[#344157]",
  "toolbar-backdrop":
    "fixed inset-0 z-40 cursor-default border-0 bg-transparent",
  "toolbar-menu-button":
    "flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-[5px] border border-[#4a5669] bg-[#273348] px-2.5 text-[10px] font-[680] text-[#d8dde4] hover:border-[#69768b] [&_span]:grid [&_span]:size-[17px] [&_span]:place-items-center [&_span]:rounded-full [&_span]:bg-lime [&_span]:font-mono [&_span]:text-[8px] [&_span]:font-extrabold [&_span]:text-ink [&::-webkit-details-marker]:hidden max-[760px]:px-2",
  "toolbar-options-panel":
    "absolute top-[calc(100%+8px)] right-0 z-50 w-[430px] rounded-lg border border-[#cfd3de] bg-[#fbfaf6] p-3 text-ink shadow-[0_12px_35px_rgb(16_27_44/24%)] max-[520px]:fixed max-[520px]:top-[54px] max-[520px]:right-2 max-[520px]:left-2 max-[520px]:w-auto",
  "toolbar-panel-heading":
    "mb-2.5 flex flex-col gap-0.5 border-b border-line pb-2 [&_strong]:text-[11px] [&_span]:text-[9px] [&_span]:text-muted",
  "toolbar-filter-grid":
    "grid grid-cols-2 gap-1.5 [&_.filter-toggle]:justify-start [&_.filter-toggle]:py-2",
  "toolbar-loader-panel":
    "absolute top-[calc(100%+8px)] right-0 z-50 w-[540px] rounded-lg border border-[#536075] bg-[#1f2b3e] p-2.5 shadow-[0_12px_35px_rgb(16_27_44/28%)] max-[620px]:fixed max-[620px]:top-[54px] max-[620px]:right-2 max-[620px]:left-2 max-[620px]:w-auto",
  "toolbar-pr-loader":
    "grid min-h-[38px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-[#445066] bg-[#263247] py-1 pr-1 pl-2.5 [&_input]:min-w-0 [&_input]:border-0 [&_input]:bg-transparent [&_input]:text-[11px] [&_input]:text-white [&_input]:outline-none [&_input]:focus-visible:outline-2 [&_input]:focus-visible:outline-offset-2 [&_input]:focus-visible:outline-lime [&_input::placeholder]:text-[#9ea8b7]",
  "toolbar-refresh":
    "flex h-8 cursor-pointer items-center gap-1.5 rounded-[5px] border border-[#4a5669] bg-[#273348] px-2.5 text-[10px] font-[680] text-[#d8dde4] hover:border-[#69768b] disabled:cursor-wait disabled:opacity-65 max-[900px]:px-2 max-[900px]:[&_.toolbar-refresh-label]:hidden",
  "toolbar-refresh-label": "whitespace-nowrap",
  "toolbar-settings-link":
    "grid size-8 shrink-0 place-items-center rounded-[5px] border border-[#4a5669] bg-[#273348] text-sm text-[#d8dde4] no-underline hover:border-[#69768b]",
  "topbar-settings-link":
    "rounded-md border border-[#4a5669] px-3 py-2 text-[10px] font-[680] text-[#d8dde4] no-underline hover:border-[#69768b]",
  brand: "flex min-w-0 items-center gap-[9px]",
  "brand-mark":
    "grid size-[30px] -rotate-3 place-items-center rounded-[7px_2px_7px_2px] bg-lime font-black text-ink",
  "brand-name": "text-[22px] font-[760] tracking-[-0.04em]",
  "brand-tagline":
    "overflow-hidden border-l border-white/20 pl-2.5 text-xs text-[#aeb6be] text-ellipsis whitespace-nowrap max-[1040px]:hidden",
  "pr-loader":
    "grid min-h-[42px] grid-cols-[auto_1fr_auto] items-center gap-[9px] rounded-lg border border-[#445066] bg-[#263247] py-1 pr-1 pl-[13px] shadow-[inset_0_1px_rgb(255_255_255/5%)] [&_input]:min-w-0 [&_input]:border-0 [&_input]:bg-transparent [&_input]:text-[13px] [&_input]:text-white [&_input]:outline-none [&_input]:focus-visible:outline-2 [&_input]:focus-visible:outline-offset-2 [&_input]:focus-visible:outline-lime [&_input::placeholder]:text-[#9ea8b7]",
  "github-glyph":
    "grid size-5 place-items-center rounded-full bg-white text-[11px] font-extrabold text-ink",
  "load-button":
    "min-h-8 cursor-pointer rounded-[5px] border-0 bg-lime px-[15px] text-xs font-[780] text-ink hover:bg-[#e5ff85] disabled:cursor-wait disabled:opacity-70",
  "shortcut-hint":
    "justify-self-end text-[11px] text-[#9da7b4] max-[1040px]:hidden",
  "error-banner":
    "border-b border-[#e9aea3] bg-[#ffd9d2] px-7 py-2.5 text-[13px] font-semibold text-[#73251d]",
  "review-loading":
    "grid min-h-[calc(100vh-68px)] place-items-center bg-canvas px-5 py-12",
  "review-loading-card":
    "flex w-full max-w-[520px] items-center gap-4 rounded-xl border border-line bg-paper px-5 py-[18px] shadow-[0_8px_28px_rgb(16_27_44/9%)]",
  "review-loading-spinner":
    "size-8 shrink-0 rounded-full border-[3px] border-[#d8d8d2] border-t-lime-dark [animation:refresh-spin_800ms_linear_infinite]",
  "review-loading-copy":
    "flex min-w-0 flex-col gap-1 [&_strong]:text-sm [&_code]:overflow-hidden [&_code]:text-[11px] [&_code]:text-[#40546d] [&_code]:text-ellipsis [&_code]:whitespace-nowrap [&_span]:text-[10px] [&_span]:text-muted",
  "review-load-error":
    "grid min-h-[calc(100vh-108px)] place-content-center gap-1 bg-canvas px-5 text-center [&_strong]:text-sm [&_span]:text-[10px] [&_span]:text-muted",
  "review-header":
    "flex items-end justify-between gap-9 border-b border-line bg-paper/90 px-8 pt-[27px] pb-[22px] max-[1040px]:flex-col max-[1040px]:items-start max-[760px]:px-[17px] max-[760px]:py-5",
  "review-title-block":
    "min-w-0 [&_h1]:my-2 [&_h1]:mb-2.5 [&_h1]:max-w-[900px] [&_h1]:text-[clamp(22px,2vw,31px)] [&_h1]:leading-[1.1] [&_h1]:font-[680] [&_h1]:tracking-[-0.035em]",
  "review-backing":
    "rounded-full border border-[#bbc2ca] bg-[#eef0f2] px-2 py-1 font-mono text-[8px] font-[800] tracking-[0.08em] text-[#536071] [&.is-local]:cursor-pointer [&.is-local]:border-[#aaba74] [&.is-local]:bg-[#edf4d3] [&.is-local]:text-[#526522] [&.is-local:disabled]:cursor-wait [&.is-local:disabled]:opacity-70",
  "revision-available":
    "cursor-pointer rounded-full border border-[#9bbb2f] bg-lime px-2.5 py-1 text-[9px] font-[750] text-ink hover:brightness-95",
  "revision-checking": "font-mono text-[9px] text-muted",
  "repo-line": "flex items-center gap-2 text-xs text-muted",
  "branch-line":
    "flex items-center gap-2 text-xs text-muted max-[760px]:flex-wrap [&_code]:rounded-sm [&_code]:bg-[#e7e9e8] [&_code]:px-1.5 [&_code]:py-[3px] [&_code]:font-mono [&_code]:text-[10px] [&_code]:text-[#314663]",
  "repo-name": "font-[760] text-[#324b65] underline-offset-2 hover:underline",
  "pr-number": "text-[#8b8f88]",
  "agent-badge":
    "rounded-[3px] bg-lime px-1.5 pt-[3px] pb-0.5 font-mono text-[9px] font-extrabold tracking-[0.08em] text-[#405400]",
  "review-stats":
    "flex shrink-0 items-end gap-5 max-[1040px]:w-full max-[760px]:flex-wrap max-[760px]:gap-2.5",
  "is-spinning": "[animation:refresh-spin_800ms_linear_infinite]",
  "stat-block":
    "flex flex-col gap-0.5 border-l-2 border-[#cfd0ca] pl-3 [&.plus]:border-l-[#61b58d] [&.minus]:border-l-[#e78f80] [&_strong]:font-mono [&_strong]:text-base [&_span]:text-[10px] [&_span]:tracking-[0.06em] [&_span]:text-muted [&_span]:uppercase",
  plus: "text-[#237f56]",
  minus: "text-[#c85243]",
  "progress-block": "w-[150px] pl-1.5 max-[1040px]:ml-auto",
  "progress-label":
    "mb-[7px] flex justify-between text-[10px] text-muted [&_strong]:text-ink",
  "progress-track": "h-[7px] overflow-hidden rounded-lg bg-[#dedfd8]",
  "progress-fill":
    "block h-full rounded-[inherit] bg-lime-dark transition-[width] duration-180 ease-out",
  controlbar:
    "sticky top-[68px] z-[15] flex min-h-[62px] items-center gap-3.5 border-b border-line bg-[#fbfaf6] px-8 py-[9px] shadow-[0_3px_10px_rgb(16_27_44/4%)] max-[760px]:static max-[760px]:overflow-x-auto max-[760px]:items-start max-[760px]:px-4 max-[760px]:py-2.5",
  "control-group":
    "flex items-center gap-2 [&.filters]:max-[760px]:min-w-[390px] [&.filters]:max-[760px]:flex-wrap [&.filters]:max-[760px]:items-start",
  "control-label":
    "mr-0.5 text-[10px] font-[720] tracking-[0.07em] text-[#80857e] uppercase",
  segmented: "flex rounded-[7px] bg-[#e8e8e2] p-[3px]",
  "segmented-button":
    "cursor-pointer rounded-[5px] border-0 bg-transparent px-[11px] py-[7px] text-[11px] font-[650] text-[#6e746e] [&.is-active]:bg-white [&.is-active]:text-ink [&.is-active]:shadow-[0_1px_4px_rgb(16_27_44/15%)]",
  "control-divider": "h-[30px] w-px bg-line",
  "filter-toggle":
    "flex cursor-pointer items-center gap-1.5 rounded-md border border-[#d5d6cf] bg-[#f4f3ee] px-[9px] py-[7px] text-[11px] font-[620] text-[#676c66] hover:border-[#aeb29f] [&.is-active]:border-[#b6bb9f] [&.is-active]:bg-white [&.is-active]:text-ink [&.is-active_.toggle-dot]:bg-lime-dark [&.is-active_.toggle-dot]:shadow-[0_0_0_3px_rgb(155_183_47/14%)]",
  "inline-diff-picker":
    "col-span-2 flex items-center justify-between rounded-md border border-[#d5d6cf] bg-[#f4f3ee] px-[9px] py-1.5 [&_.control-label]:text-[11px] [&_.segmented]:bg-[#e7e6e0]",
  "toggle-dot": "block size-[7px] rounded-full bg-[#aeb1ab]",
  "control-spacer": "flex-1",
  "github-reviews-status":
    "flex gap-2 border-b border-[#d8dae4] bg-[#f2f3f8] px-[18px] py-2 text-[10px] text-[#4d5264] [&.is-error]:border-b-[#edcbc5] [&.is-error]:bg-[#fff0ed] [&.is-error]:text-[#793b31]",
  "commits-browser":
    "mx-auto my-6 w-[min(920px,calc(100%-32px))] overflow-hidden rounded-xl border border-line bg-paper shadow-[0_8px_28px_rgb(16_27_44/9%)]",
  "commits-heading":
    "flex items-end justify-between gap-4 border-b border-line bg-[#f8f7f2] px-5 py-4 [&_h2]:m-0 [&_h2]:text-xl [&_p]:mt-1 [&_p]:mb-0 [&_p]:text-[11px] [&_p]:text-muted [&>span]:text-[9px] [&>span]:font-[700] [&>span]:tracking-[0.06em] [&>span]:text-muted [&>span]:uppercase",
  "commit-list": "flex flex-col",
  "commit-row":
    "grid w-full cursor-pointer grid-cols-[34px_minmax(0,1fr)_auto_18px] items-center gap-3 border-0 border-t border-line bg-white px-5 py-3.5 text-left first:border-t-0 hover:bg-[#f6f8ef]",
  "commit-avatar":
    "grid size-[34px] place-items-center rounded-full bg-[#dfe6cb] font-mono text-[9px] font-[800] text-[#42522e]",
  "commit-copy":
    "flex min-w-0 flex-col gap-1 [&_strong]:overflow-hidden [&_strong]:text-[13px] [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&>span]:overflow-hidden [&>span]:text-[10px] [&>span]:text-muted [&>span]:text-ellipsis [&>span]:whitespace-nowrap [&_small]:text-[9px] [&_small]:text-[#8a8f87]",
  "commit-sha":
    "rounded bg-[#e9ebe6] px-2 py-1 font-mono text-[10px] text-[#43546a]",
  "commit-open-arrow": "text-base text-[#81914a]",
  "commits-empty": "px-5 py-12 text-center text-xs text-muted",
  "commits-state":
    "mx-auto my-8 grid w-[min(680px,calc(100%-32px))] grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-paper px-5 py-4 shadow-[0_5px_18px_rgb(16_27_44/7%)] [&>.semantic-icon]:row-span-2 [&>strong]:text-[12px] [&>span:not(.semantic-icon)]:text-[10px] [&>span:not(.semantic-icon)]:text-muted [&.is-error]:border-[#edcbc5] [&.is-error]:bg-[#fff4f1]",
  "commit-detail-header":
    "flex min-h-14 items-center gap-3 border-b border-line bg-[#f4f2eb] px-[18px] [&>.commit-back]:mr-1 [&>code]:rounded bg-[#dfe3df] px-2 py-1 font-mono text-[10px] [&>div]:flex [&>div]:min-w-0 [&>div]:flex-1 [&>div]:flex-col [&>div]:gap-0.5 [&>div_>strong]:overflow-hidden [&>div_>strong]:text-xs [&>div_>strong]:text-ellipsis [&>div_>strong]:whitespace-nowrap [&>div_>span]:text-[9px] [&>div_>span]:text-muted [&>a]:text-[10px] [&>a]:font-[650] [&>a]:text-[#40576e] [&>a]:no-underline",
  "commit-back":
    "cursor-pointer rounded-md border border-[#c9cbc4] bg-white px-2.5 py-1.5 text-[10px] font-[680] text-[#3f5060]",
  "repository-shell": "min-h-screen bg-canvas",
  "repository-toolbar":
    "sticky top-0 z-30 grid min-h-14 grid-cols-[auto_auto_auto_minmax(220px,440px)_minmax(240px,1fr)_auto_auto] items-center gap-3 border-b border-[#3b4659] bg-ink px-4 py-2 text-white shadow-[0_5px_18px_rgb(16_27_44/18%)] [&>.compact-brand]:text-white [&>.compact-brand]:no-underline max-[1100px]:grid-cols-[auto_auto_minmax(220px,1fr)_minmax(240px,1fr)_auto_auto] max-[1100px]:[&_.repository-identity]:hidden max-[760px]:grid-cols-[auto_auto_1fr] max-[760px]:gap-2",
  "repository-identity":
    "flex min-w-0 flex-col [&>span]:text-[8px] [&>span]:tracking-[0.08em] [&>span]:text-[#9da7b4] [&>span]:uppercase [&>strong]:overflow-hidden [&>strong]:text-xs [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap",
  "repository-search":
    "grid h-9 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-[#4a5669] bg-[#263247] pl-3 [&>span]:text-[#aeb6be] [&_select]:max-w-24 [&_select]:rounded [&_select]:border [&_select]:border-[#566277] [&_select]:bg-[#344057] [&_select]:px-1.5 [&_select]:py-1 [&_select]:text-[9px] [&_select]:font-[700] [&_select]:text-white [&_select]:outline-none [&_input]:min-w-0 [&_input]:border-0 [&_input]:bg-transparent [&_input]:text-[12px] [&_input]:text-white [&_input]:outline-none [&_input]:focus-visible:outline-2 [&_input]:focus-visible:outline-offset-2 [&_input]:focus-visible:outline-lime [&_input::placeholder]:text-[#8f9baa] [&_button]:h-7 [&_button]:cursor-pointer [&_button]:rounded-[4px] [&_button]:border-0 [&_button]:bg-lime [&_button]:px-3 [&_button]:text-[10px] [&_button]:font-[750] [&_button]:text-ink [&.is-hidden]:invisible [&.is-hidden]:pointer-events-none max-[760px]:order-3 max-[760px]:col-span-3",
  "repository-view-tabs":
    "shrink-0 bg-[#303b50] [&_.segmented-button]:px-2.5 [&_.segmented-button]:py-1.5 [&_.segmented-button]:text-[10px] [&_.segmented-button]:text-[#b9c0cb] [&_.segmented-button.is-active]:bg-[#f7f7f3] [&_.segmented-button.is-active]:text-ink",
  "repository-github-loader":
    "grid h-9 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-[#4a5669] bg-[#263247] pr-1 pl-2.5 [&.is-error]:border-[#dc8c7f] [&_input]:min-w-0 [&_input]:border-0 [&_input]:bg-transparent [&_input]:text-[11px] [&_input]:text-white [&_input]:outline-none [&_input]:focus-visible:outline-2 [&_input]:focus-visible:outline-offset-2 [&_input]:focus-visible:outline-lime [&_input::placeholder]:text-[#8f9baa] [&_.load-button]:min-h-7 [&_.load-button]:px-3 max-[760px]:order-2",
  "repository-github-link":
    "rounded-md border border-[#4a5669] px-3 py-2 text-[10px] font-[650] text-[#d8dde4] no-underline hover:border-[#7d899b]",
  "repository-workspace":
    "grid min-h-[calc(100vh-56px)] grid-cols-[330px_minmax(0,1fr)] [&.is-commits]:grid-cols-1 max-[760px]:grid-cols-1",
  "repository-commit-row": "text-ink no-underline",
  "repository-commits-browser": "my-8",
  "repository-pulls-browser":
    "mx-auto my-8 w-[min(940px,calc(100%-32px))] overflow-hidden rounded-xl border border-line bg-paper shadow-[0_7px_24px_rgb(16_27_44/7%)]",
  "repository-pulls-heading":
    "flex items-end justify-between gap-5 border-b border-line bg-[#f5f4ef] px-6 py-5 max-[680px]:items-start max-[680px]:flex-col [&>div:first-child>span]:font-mono [&>div:first-child>span]:text-[9px] [&>div:first-child>span]:font-[800] [&>div:first-child>span]:tracking-[0.1em] [&>div:first-child>span]:text-[#748047] [&_h1]:mt-1 [&_h1]:mb-1 [&_h1]:text-xl [&_p]:m-0 [&_p]:text-[10px] [&_p]:text-muted",
  "repository-pull-filters":
    "shrink-0 bg-[#e5e5df] [&_.segmented-button]:px-3 [&_.segmented-button]:py-2 [&_.segmented-button]:text-[10px]",
  "repository-pull-list": "divide-y divide-line",
  "repository-pull-row":
    "grid min-h-[76px] grid-cols-[34px_minmax(0,1fr)_auto_18px] items-start gap-3 px-5 py-4 text-ink no-underline hover:bg-[#f8f8f3] max-[620px]:grid-cols-[30px_minmax(0,1fr)_auto] max-[620px]:[&>.commit-open-arrow]:hidden",
  "repository-pull-avatar":
    "grid size-8 place-items-center rounded-full bg-[#dce2d4] object-cover font-mono text-[9px] font-[800] text-[#52624d]",
  "repository-pull-title":
    "flex min-w-0 items-baseline gap-2 [&>strong]:overflow-hidden [&>strong]:text-[12px] [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap [&>code]:shrink-0 [&>code]:font-mono [&>code]:text-[9px] [&>code]:text-muted",
  "repository-pull-copy":
    "min-w-0 [&>small]:mt-1 [&>small]:block [&>small]:overflow-hidden [&>small]:text-[9px] [&>small]:text-ellipsis [&>small]:whitespace-nowrap [&>small]:text-muted",
  "repository-pull-labels":
    "mt-2 flex flex-wrap gap-1 [&>span]:rounded-full [&>span]:border [&>span]:border-[#d4d8c9] [&>span]:bg-[#edf1e2] [&>span]:px-2 [&>span]:py-0.5 [&>span]:text-[8px] [&>span]:font-[650] [&>span]:text-[#59664b]",
  "repository-pull-state":
    "mt-0.5 rounded-full border px-2 py-1 text-[8px] font-[750] [&.is-open]:border-[#9ecdad] [&.is-open]:bg-[#e2f5e8] [&.is-open]:text-[#25653d] [&.is-closed]:border-[#e5aaa1] [&.is-closed]:bg-[#ffebe7] [&.is-closed]:text-[#8c3328] [&.is-merged]:border-[#c4b2e6] [&.is-merged]:bg-[#eee8fb] [&.is-merged]:text-[#5f4495] [&.is-draft]:border-[#c9cbc4] [&.is-draft]:bg-[#eeeeea] [&.is-draft]:text-[#666b65]",
  "repository-pull-load-more":
    "mx-auto my-4 block min-h-9 cursor-pointer rounded-md border border-[#bfc6ac] bg-[#f6f8ee] px-5 text-[10px] font-[750] text-[#4e612d] hover:border-[#9faf6f] disabled:cursor-wait disabled:opacity-60",
  "repository-pull-page-error":
    "m-4 rounded-md border border-[#e3aaa0] bg-[#fff0ed] px-3 py-2 text-[10px] text-[#8a3228]",
  "repository-tree":
    "sticky top-14 flex h-[calc(100vh-56px)] flex-col overflow-hidden border-r border-line bg-[#ecebe5] max-[760px]:static max-[760px]:h-[300px] max-[760px]:border-r-0 max-[760px]:border-b [&>nav]:overflow-auto [&>nav]:px-2 [&>nav]:pb-3",
  "repository-tree-heading":
    "flex items-center justify-between border-b border-line px-4 py-3 text-xs [&>span]:rounded-full [&>span]:bg-[#d8d8d2] [&>span]:px-2 [&>span]:py-1 [&>span]:font-mono [&>span]:text-[9px] [&>span]:text-muted",
  "repository-file-row":
    "grid w-full cursor-pointer grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-1.5 text-left hover:bg-white/60 [&.is-selected]:bg-white [&.is-selected]:shadow-[inset_3px_0_#9bbb2f] [&>span:nth-child(2)]:overflow-hidden [&>span:nth-child(2)]:font-mono [&>span:nth-child(2)]:text-[10px] [&>span:nth-child(2)]:text-ellipsis [&>span:nth-child(2)]:whitespace-nowrap [&>small]:font-mono [&>small]:text-[8px] [&>small]:text-muted",
  "repository-file-icon":
    "grid size-5 place-items-center rounded bg-[#d8ddd5] font-mono text-[8px] text-[#52635a]",
  "repository-main": "min-w-0",
  "repository-welcome":
    "mx-auto mt-[12vh] flex max-w-[520px] flex-col items-center px-5 text-center [&>span]:rounded-full [&>span]:bg-lime [&>span]:px-3 [&>span]:py-2 [&>span]:font-mono [&>span]:text-[10px] [&>span]:font-[800] [&_h1]:mb-1 [&_h1]:text-3xl [&_p]:text-xs [&_p]:leading-6 [&_p]:text-muted",
  "repository-clone-offer":
    "mx-auto mt-[12vh] flex max-w-[560px] flex-col items-center px-5 text-center [&_h1]:mb-1 [&_h1]:text-2xl [&_p]:max-w-[500px] [&_p]:text-xs [&_p]:leading-6 [&_p]:text-muted [&_small]:mt-3 [&_small]:text-[9px] [&_small]:text-muted",
  "repository-clone-mark":
    "grid size-11 place-items-center rounded-xl bg-lime font-mono text-[11px] font-[850] text-ink",
  "repository-clone-actions":
    "mt-4 flex flex-wrap justify-center gap-2 [&_button]:min-h-9 [&_button]:cursor-pointer [&_button]:rounded-md [&_button]:border [&_button]:border-[#aeb89a] [&_button]:bg-paper [&_button]:px-4 [&_button]:text-[11px] [&_button]:font-[700] [&_button]:text-ink [&_button:first-child]:bg-lime [&_button:disabled]:cursor-wait [&_button:disabled]:opacity-60",
  "repository-clone-error":
    "mt-3 rounded-md border border-[#e9aea3] bg-[#fff0ed] px-3 py-2 text-[10px] text-[#73251d]",
  "home-shell": "min-h-screen bg-canvas pb-16",
  "home-toolbar":
    "sticky top-0 z-30 grid min-h-[68px] grid-cols-[auto_minmax(360px,680px)_auto] items-center justify-between gap-5 border-b border-[#3b4659] bg-ink px-7 py-3 text-white shadow-[0_5px_18px_rgb(16_27_44/18%)] [&_.pr-loader]:w-full max-[760px]:static max-[760px]:grid-cols-[1fr_auto] max-[760px]:gap-3 max-[760px]:px-4 max-[760px]:[&_.pr-loader]:order-3 max-[760px]:[&_.pr-loader]:col-span-2",
  "home-heading":
    "mx-auto flex w-[min(1120px,calc(100%-40px))] items-end justify-between gap-8 border-b border-line pt-12 pb-7 max-[700px]:w-[calc(100%-28px)] max-[700px]:flex-col max-[700px]:items-stretch max-[700px]:pt-8 [&>div>span]:font-mono [&>div>span]:text-[9px] [&>div>span]:font-[800] [&>div>span]:tracking-[0.12em] [&>div>span]:text-[#738044] [&_h1]:mt-1 [&_h1]:mb-1 [&_h1]:text-[32px] [&_h1]:tracking-[-0.04em] [&_p]:m-0 [&_p]:text-xs [&_p]:text-muted [&>input]:h-10 [&>input]:w-[320px] [&>input]:rounded-lg [&>input]:border [&>input]:border-[#c9cbc4] [&>input]:bg-paper [&>input]:px-3.5 [&>input]:text-xs [&>input]:outline-none [&>input]:focus-visible:border-[#9bbb2f] [&>input]:focus-visible:ring-2 [&>input]:focus-visible:ring-[#9bbb2f]/20 max-[700px]:[&>input]:w-full",
  "home-repository-state":
    "mx-auto mt-8 flex w-[min(1120px,calc(100%-40px))] flex-col gap-1 rounded-xl border border-line bg-paper px-5 py-8 text-center shadow-[0_6px_22px_rgb(16_27_44/7%)] [&>strong]:text-sm [&>span]:text-[10px] [&>span]:text-muted [&.is-error]:border-[#edcbc5] [&.is-error]:bg-[#fff0ed]",
  "home-repository-sections":
    "mx-auto grid w-[min(1120px,calc(100%-40px))] gap-8 pt-8 max-[700px]:w-[calc(100%-28px)]",
  "home-repository-section": "min-w-0",
  "home-repository-section-heading":
    "mb-3 flex items-end justify-between gap-4 px-1 [&>div]:min-w-0 [&_h2]:m-0 [&_h2]:text-sm [&_h2]:font-[760] [&_code]:mt-1 [&_code]:block [&_code]:overflow-hidden [&_code]:font-mono [&_code]:text-[9px] [&_code]:text-muted [&_code]:text-ellipsis [&_code]:whitespace-nowrap [&>span]:grid [&>span]:h-6 [&>span]:min-w-6 [&>span]:place-items-center [&>span]:rounded-full [&>span]:bg-[#dedfd8] [&>span]:px-2 [&>span]:font-mono [&>span]:text-[9px] [&>span]:text-muted",
  "home-repository-grid": "grid grid-cols-2 gap-2.5 max-[800px]:grid-cols-1",
  "home-repository-card":
    "grid min-h-[76px] grid-cols-[38px_minmax(0,1fr)_auto_18px] items-center gap-3 rounded-xl border border-line bg-paper px-4 py-3 text-ink no-underline shadow-[0_2px_7px_rgb(16_27_44/4%)] transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-[#aaba74] hover:shadow-[0_7px_18px_rgb(16_27_44/8%)]",
  "home-repository-icon":
    "grid size-[38px] place-items-center rounded-lg bg-[#e7edcf] font-mono text-[9px] font-[850] text-[#526323]",
  "home-repository-copy":
    "flex min-w-0 flex-col gap-1 [&>strong]:overflow-hidden [&>strong]:text-xs [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap [&>code]:overflow-hidden [&>code]:font-mono [&>code]:text-[8px] [&>code]:text-muted [&>code]:text-ellipsis [&>code]:whitespace-nowrap",
  "home-repository-source":
    "rounded-full border px-2 py-1 text-[8px] font-[700] [&.is-configured]:border-[#c7d49c] [&.is-configured]:bg-[#eff5db] [&.is-configured]:text-[#536524] [&.is-temporary]:border-[#ccd3dd] [&.is-temporary]:bg-[#eef1f5] [&.is-temporary]:text-[#536071]",
  "home-repository-empty":
    "rounded-xl border border-dashed border-[#caccc5] px-5 py-8 text-center text-[10px] text-muted",
  "settings-shell": "min-h-screen bg-canvas pb-14",
  "settings-toolbar":
    "sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[#3b4659] bg-ink px-5 text-white shadow-[0_5px_18px_rgb(16_27_44/18%)] [&>.compact-brand]:mr-auto [&>span]:text-[10px] [&>span]:tracking-[0.08em] [&>span]:text-[#9da7b4] [&>span]:uppercase [&>a:last-child]:rounded-md [&>a:last-child]:border [&>a:last-child]:border-[#4a5669] [&>a:last-child]:px-3 [&>a:last-child]:py-2 [&>a:last-child]:text-[10px] [&>a:last-child]:font-[700] [&>a:last-child]:text-white [&>a:last-child]:no-underline",
  "settings-heading":
    "mx-auto w-[min(920px,calc(100%-32px))] pt-10 pb-6 [&>span]:font-mono [&>span]:text-[9px] [&>span]:font-[800] [&>span]:tracking-[0.1em] [&>span]:text-[#748047] [&_h1]:my-2 [&_h1]:text-4xl [&_h1]:tracking-[-0.04em] [&_p]:m-0 [&_p]:max-w-[620px] [&_p]:text-xs [&_p]:leading-6 [&_p]:text-muted",
  "settings-state":
    "mx-auto w-[min(920px,calc(100%-32px))] rounded-xl border border-line bg-paper px-5 py-8 text-sm shadow-[0_7px_24px_rgb(16_27_44/7%)] [&.is-error]:border-[#edcbc5] [&.is-error]:bg-[#fff0ed] [&>span]:mt-1 [&>span]:block [&>span]:text-[10px]",
  "settings-form": "mx-auto grid w-[min(920px,calc(100%-32px))] gap-4",
  "settings-section":
    "overflow-hidden rounded-xl border border-line bg-paper px-6 py-5 shadow-[0_7px_24px_rgb(16_27_44/7%)] max-[620px]:px-4",
  "settings-section-heading":
    "mb-5 grid grid-cols-[34px_minmax(0,1fr)] gap-3 border-b border-line pb-4 [&>span]:grid [&>span]:size-8 [&>span]:place-items-center [&>span]:rounded-lg [&>span]:bg-lime [&>span]:font-mono [&>span]:text-[9px] [&>span]:font-[850] [&_h2]:m-0 [&_h2]:text-lg [&_p]:mt-1 [&_p]:mb-0 [&_p]:text-[10px] [&_p]:leading-5 [&_p]:text-muted",
  "settings-field":
    "mb-4 grid gap-1.5 [&>span]:text-[10px] [&>span]:font-[750] [&>input]:h-10 [&>input]:rounded-md [&>input]:border [&>input]:border-[#cfd0ca] [&>input]:bg-[#faf9f5] [&>input]:px-3 [&>input]:font-mono [&>input]:text-[11px] [&>input]:outline-none [&>input]:focus:border-[#9bbb2f] [&>small]:text-[9px] [&>small]:text-muted",
  "settings-choice-row":
    "flex items-center justify-between gap-4 border-b border-line py-3 last:border-b-0 max-[620px]:items-start max-[620px]:flex-col [&>span]:text-[11px] [&>span]:font-[720]",
  "settings-choices": "flex flex-wrap rounded-lg bg-[#e8e8e2] p-1",
  "settings-choice":
    "cursor-pointer rounded-md border-0 bg-transparent px-3 py-2 text-[10px] font-[680] text-[#686e68] [&.is-active]:bg-white [&.is-active]:text-ink [&.is-active]:shadow-[0_1px_4px_rgb(16_27_44/15%)]",
  "settings-toggle-grid": "mt-4 grid grid-cols-2 gap-2 max-[680px]:grid-cols-1",
  "settings-toggle":
    "flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line bg-[#f7f6f1] px-3 py-3 text-left [&>span:first-child]:flex [&>span:first-child]:flex-col [&_strong]:text-[10px] [&_small]:mt-1 [&_small]:text-[9px] [&_small]:font-normal [&_small]:text-muted [&.is-active]:border-[#b7c681] [&.is-active]:bg-[#f6f9ea]",
  "settings-switch":
    "relative h-5 w-9 shrink-0 rounded-full bg-[#c6c9c3] p-0.5 transition-colors [.is-active_&]:bg-[#9bbb2f] [&>i]:block [&>i]:size-4 [&>i]:rounded-full [&>i]:bg-white [&>i]:shadow-sm [&>i]:transition-transform [.is-active_&>i]:translate-x-4",
  "settings-footer":
    "sticky bottom-4 z-20 flex items-center gap-3 rounded-xl border border-[#c7c9c1] bg-[rgb(251_250_246/96%)] px-4 py-3 shadow-[0_10px_35px_rgb(16_27_44/15%)] backdrop-blur max-[620px]:flex-wrap [&>div]:mr-auto [&>div]:flex [&>div]:min-w-0 [&>div]:flex-col [&>div>span]:text-[9px] [&>div>span]:text-muted [&>div>code]:overflow-hidden [&>div>code]:max-w-[480px] [&>div>code]:font-mono [&>div>code]:text-[9px] [&>div>code]:text-ellipsis [&>div>code]:whitespace-nowrap",
  "settings-save":
    "min-h-9 cursor-pointer rounded-md border-0 bg-lime px-4 text-[11px] font-[780] text-ink disabled:cursor-wait disabled:opacity-60",
  "settings-save-status":
    "text-[10px] font-[700] text-[#557020] [&.is-error]:max-w-[280px] [&.is-error]:text-[#9d3f34]",
  "repository-results-state":
    "mx-5 mt-5 flex flex-col gap-1 rounded-lg border border-line bg-paper px-4 py-5 [&>strong]:text-xs [&>span]:text-[10px] [&>span]:text-muted [&.is-error]:border-[#edcbc5] [&.is-error]:bg-[#fff0ed]",
  "repository-search-results":
    "grid gap-6 p-5 [&_section]:min-w-0 [&_h2]:mb-2 [&_h2]:text-xs [&_h2]:tracking-[0.03em] [&_p]:text-[10px] [&_p]:text-muted",
  "repository-filename-results":
    "grid grid-cols-2 gap-1 rounded-lg border border-line bg-[#efeee9] p-1 max-[900px]:grid-cols-1",
  "repository-content-results": "grid gap-2",
  "repository-search-match":
    "overflow-hidden rounded-lg border border-line bg-paper text-left shadow-[0_2px_8px_rgb(16_27_44/5%)] hover:border-[#aaba74] [&.is-definition]:border-l-[3px] [&.is-definition]:border-l-[#9bbb2f] [&>pre]:m-0 [&>pre]:overflow-x-auto [&>pre]:bg-[#f6f5f0] [&>pre]:py-2 [&>pre]:font-mono [&>pre]:text-[10px] [&>pre>div]:grid [&>pre>div]:grid-cols-[42px_minmax(max-content,1fr)] [&>pre>div.is-match]:bg-[#f0f6d9] [&>pre>div>span]:pr-2 [&>pre>div>span]:text-right [&>pre>div>span]:text-[#9a9e96] [&>pre>div>code]:pr-3",
  "repository-match-heading":
    "flex items-center gap-2 border-b border-line px-3 py-2 [&>strong]:overflow-hidden [&>strong]:text-[10px] [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap [&>code]:text-[9px] [&>code]:text-muted [&>span]:ml-auto [&>span]:rounded-full [&>span]:bg-[#e7efca] [&>span]:px-2 [&>span]:py-1 [&>span]:text-[8px] [&>span]:font-[700] [&>span]:text-[#506323]",
  "repository-file-view":
    "m-5 overflow-hidden rounded-lg border border-line bg-paper shadow-[0_6px_22px_rgb(16_27_44/8%)]",
  "repository-file-heading":
    "flex min-h-12 items-center gap-3 border-b border-line bg-[#f7f6f1] px-3 [&>strong]:min-w-0 [&>strong]:flex-1 [&>strong]:overflow-hidden [&>strong]:font-mono [&>strong]:text-[11px] [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap [&>span]:text-[9px] [&>span]:text-muted",
  "repository-source":
    "m-0 max-h-[calc(100vh-150px)] overflow-auto bg-paper p-4 font-mono text-[11px] leading-[1.65] [&>code]:block [&>code]:min-w-max",
  legend:
    "flex items-center gap-[13px] text-[9px] tracking-[0.05em] text-[#898d87] uppercase max-[1040px]:hidden [&_span]:flex [&_span]:items-center [&_span]:gap-1.5 [&_i]:size-[9px] [&_i]:rounded-sm",
  "legend-add": "bg-[#74cba1]",
  "legend-remove": "bg-[#ef9382]",
  "legend-move": "bg-[#a18bd8]",
  workspace:
    "grid min-h-[calc(100vh-235px)] grid-cols-[278px_minmax(0,1fr)] transition-[grid-template-columns] duration-160 [&.with-expanded-toolbar]:min-h-[calc(100vh-68px)] [&.with-compact-toolbar]:min-h-[calc(100vh-48px)] [&.sidebar-collapsed]:grid-cols-[48px_minmax(0,1fr)] [&.sidebar-collapsed_.file-sidebar]:overflow-hidden [&.sidebar-collapsed_.sidebar-heading]:justify-center [&.sidebar-collapsed_.sidebar-heading]:px-0 [&.sidebar-collapsed_.sidebar-heading]:py-3 [&.sidebar-collapsed_.sidebar-heading>strong]:hidden [&.sidebar-collapsed_.sidebar-heading>span]:hidden [&.sidebar-collapsed_.file-search]:hidden [&.sidebar-collapsed_.file-list]:hidden [&.sidebar-collapsed_.sidebar-tip]:hidden max-[760px]:block max-[760px]:[&.sidebar-collapsed_.file-sidebar]:h-[50px]",
  "review-content": "min-w-0",
  "full-diff": "pb-6 [&_.diff-panel]:mb-7",
  "file-sidebar":
    "sticky top-[130px] flex h-[calc(100vh-130px)] self-start flex-col border-r border-line bg-[#ecebe5] [&.with-expanded-toolbar]:top-[68px] [&.with-expanded-toolbar]:h-[calc(100vh-68px)] [&.with-compact-toolbar]:top-12 [&.with-compact-toolbar]:h-[calc(100vh-48px)] max-[760px]:static max-[760px]:h-auto max-[760px]:max-h-[280px] max-[760px]:border-r-0 max-[760px]:border-b",
  "sidebar-heading":
    "flex items-center justify-between px-[18px] pt-[17px] pb-2.5 text-xs [&_span]:grid [&_span]:h-5 [&_span]:min-w-[23px] [&_span]:place-items-center [&_span]:rounded-[10px] [&_span]:bg-[#d8d8d2] [&_span]:px-1.5 [&_span]:font-mono [&_span]:text-[10px] [&_span]:text-[#70756e]",
  "sidebar-toggle":
    "grid size-[26px] cursor-pointer place-items-center rounded-[5px] border border-[#c9cac3] bg-[#f8f7f3] p-0 text-[17px] leading-none text-[#626961] hover:border-[#aeb29f] hover:text-ink",
  "file-search":
    "mx-3 mb-2.5 flex items-center gap-1.5 rounded-md border border-[#d6d5cf] bg-[#f8f7f3] px-[9px] py-[7px] text-[#777d76] [&_select]:max-w-[58px] [&_select]:shrink-0 [&_select]:rounded [&_select]:border [&_select]:border-[#d0d2ca] [&_select]:bg-white [&_select]:px-1 [&_select]:py-0.5 [&_select]:text-[9px] [&_select]:font-[700] [&_select]:text-[#596159] [&_input]:w-full [&_input]:min-w-0 [&_input]:border-0 [&_input]:bg-transparent [&_input]:text-[11px] [&_input]:outline-none [&_input]:focus-visible:outline-2 [&_input]:focus-visible:outline-offset-2 [&_input]:focus-visible:outline-lime",
  "file-search-error":
    "mx-3 -mt-1.5 mb-2.5 rounded border border-[#e0aaa0] bg-[#fff0ed] px-2 py-1.5 font-mono text-[9px] leading-4 text-[#8c3026]",
  "file-list": "overflow-auto px-2 pt-0.5 pb-3.5",
  "file-tree": "min-w-0",
  "file-tree-directory":
    "min-w-0 [&>.file-tree]:ml-[11px] [&>.file-tree]:border-l [&>.file-tree]:border-[#d1d2cb] [&>.file-tree]:pl-1",
  "file-tree-folder":
    "grid w-full cursor-pointer grid-cols-[15px_18px_minmax(0,1fr)_auto] items-center gap-1 rounded-[4px] border-0 bg-transparent px-1.5 py-1.5 text-left text-[#4f5750] hover:bg-white/55 focus-visible:outline-2 focus-visible:outline-lime-dark",
  "file-tree-chevron":
    "grid size-[15px] place-items-center text-[14px] leading-none text-[#7d837b]",
  "file-tree-folder-icon":
    "grid size-[17px] place-items-center font-mono text-[10px] text-[#8b9858]",
  "file-tree-folder-name":
    "overflow-hidden font-mono text-[10px] font-[700] text-ellipsis whitespace-nowrap",
  "file-tree-folder-count": "pr-1 font-mono text-[8px] text-[#969a93]",
  "file-tree-leaf": "min-w-0",
  "file-row":
    "grid w-full cursor-pointer grid-cols-[23px_minmax(0,1fr)_auto] items-center gap-2 rounded-[5px] border-0 border-l-[3px] border-l-transparent bg-transparent px-1.5 py-1.5 text-left hover:bg-white/60 [&.is-selected]:border-l-lime-dark [&.is-selected]:bg-paper [&.is-selected]:shadow-[0_1px_4px_rgb(16_27_44/8%)]",
  "file-status":
    "grid size-5 place-items-center rounded-sm bg-[#d7dbdf] font-mono text-[9px] font-[850] text-[#4d5964]",
  "status-added": "bg-[#c8efdb] text-[#176642]",
  "status-deleted": "bg-[#ffd3ca] text-[#9d3f34]",
  "status-renamed": "bg-[#dfd7f6] text-[#5c4598]",
  "file-copy": "flex min-w-0 flex-col gap-0.5",
  "file-name":
    "overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] font-[650]",
  "file-dir":
    "overflow-hidden text-ellipsis whitespace-nowrap text-[9px] text-[#8a8e88]",
  "file-delta": "flex flex-col items-end font-mono text-[8px]",
  "sidebar-tip":
    "mt-auto flex items-center gap-[9px] border-t border-line px-[15px] py-[13px] text-[9px] leading-[1.4] text-[#777c76] max-[760px]:hidden",
  "tip-icon":
    "grid size-6 place-items-center rounded-[5px] border border-[#c5c6c0] bg-[#f8f7f3] text-[#52616d]",
  "diff-panel":
    "m-[18px] min-w-0 overflow-hidden rounded-lg border border-[#d3d3cc] bg-paper shadow-[0_5px_20px_rgb(16_27_44/8%)] [&.is-collapsed]:self-start [&.is-collapsed_.file-header]:border-b-0 max-[760px]:m-2.5",
  "file-header":
    "relative flex min-h-[54px] items-center justify-between border-b border-line bg-[#f8f7f2] px-[13px] py-[9px] [&:has(.file-header-collapse-target:hover)]:bg-[#f2f1eb]",
  "file-header-collapse-target":
    "absolute inset-0 z-0 cursor-pointer border-0 bg-transparent p-0 focus-visible:-outline-offset-4",
  "file-path":
    "pointer-events-none relative z-[1] flex items-center gap-[9px] [&>span:last-child]:font-mono [&>span:last-child]:text-[11px]",
  "file-actions":
    "pointer-events-none relative z-[2] flex items-center gap-[9px] [&_button]:pointer-events-auto",
  "file-collapse-chevron":
    "grid size-[25px] place-items-center p-0 text-base text-[#667068]",
  "semantic-engine-badge":
    "rounded-[5px] border border-[#d5caef] bg-[#eee9fb] px-[7px] py-1 text-[9px] font-[720] text-[#5d4f82]",
  "path-dir": "text-[#8d918b]",
  "icon-button":
    "size-[30px] cursor-pointer rounded-[5px] border border-[#cfd0ca] bg-white text-[11px] font-[650] max-[760px]:hidden",
  "context-button":
    "min-h-[30px] cursor-pointer rounded-[5px] border border-[#cfd0ca] bg-white px-2.5 text-[11px] font-[650] text-[#4f5c55] disabled:cursor-wait disabled:opacity-60",
  "reviewed-button":
    "min-h-[30px] cursor-pointer rounded-[5px] border border-[#cfd0ca] bg-white px-[11px] text-[11px] font-[650] [&.is-reviewed]:border-lime-dark [&.is-reviewed]:bg-lime [&.is-reviewed]:text-[#233700]",
  "comment-button":
    "cursor-pointer rounded-[5px] border border-[#cfd0ca] bg-white px-2.5 py-[7px] text-[11px] font-[650] text-[#334659]",
  "semantic-banner":
    "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[11px] border-b border-[#ddd4f5] bg-[#f1edff] px-3.5 py-2.5 text-[10px] text-[#453d67] [&_div]:flex [&_div]:flex-col [&_div]:gap-0.5 [&_div_span]:text-[#736b8a] [&_strong]:text-[11px] [&.is-error]:border-b-[#edcbc5] [&.is-error]:bg-[#fff0ed] [&.is-error]:text-[#6e3027] [&.is-error_.semantic-icon]:bg-[#f4cdc6] [&.is-error_div_span]:text-[#8d5e57] max-[760px]:grid-cols-[auto_minmax(0,1fr)]",
  "semantic-icon":
    "grid size-[25px] place-items-center rounded-full bg-[#dcd2f5] text-sm",
  confidence:
    "rounded-sm border border-[#c9bee8] px-1.5 py-[3px] text-[8px] tracking-[0.05em] text-[#6e6191] uppercase max-[760px]:hidden",
  "file-context-error":
    "flex flex-col gap-[3px] border-b border-[#edcbc5] bg-[#fff0ed] px-3.5 py-2.5 text-[10px] text-[#6e3027] [&_span]:text-[#8d5e57]",
  "semantic-findings":
    "flex flex-wrap gap-1.5 border-b border-[#e2dcf1] bg-[#f8f5ff] px-[13px] py-2 text-[9px] text-[#493f67] [&_span]:rounded-full [&_span]:border [&_span]:border-[#d8ceee] [&_span]:bg-[#e9e2f8] [&_span]:px-[7px] [&_span]:py-1",
  "semantic-equal":
    "flex flex-col gap-[3px] bg-[#faf9f6] px-4 py-7 text-center text-[#4e4860] [&_span]:text-[10px] [&_span]:text-[#898391]",
  "movement-summary":
    "mx-[18px] mt-[18px] flex items-center gap-[11px] rounded-lg border border-[#d9d1ed] bg-[#f5f2fc] px-3.5 py-[13px] text-[10px] text-[#49445c] [&>div]:flex [&>div]:flex-col [&>div]:gap-[3px] [&_span]:text-[#756e86] [&.is-error]:border-[#edcbc5] [&.is-error]:bg-[#fff0ed] [&.is-error]:text-[#6e3027] [&.has-moves]:block [&.has-moves]:overflow-hidden [&.has-moves]:p-0",
  "movement-summary-heading":
    "flex items-center gap-[11px] border-b border-[#ddd5ef] px-3.5 py-3 [&>div]:flex [&>div]:flex-col [&>div]:gap-[3px]",
  "movement-list": "flex flex-col",
  "movement-row":
    "grid grid-cols-[62px_minmax(150px,1fr)_auto_minmax(150px,1fr)_minmax(160px,1.4fr)] items-center gap-[9px] border-t border-[rgb(221_213_239/65%)] px-3.5 py-[9px] first:border-t-0 [&_code]:overflow-hidden [&_code]:text-ellipsis [&_code]:whitespace-nowrap [&_code]:font-mono [&_code]:text-[#4d4661]",
  "movement-count": "text-[8px] font-[760] tracking-[0.04em] uppercase",
  "movement-arrow": "text-sm text-[#7a69a6]",
  "movement-preview":
    "overflow-hidden text-ellipsis whitespace-nowrap font-mono",
  "file-movements":
    "flex flex-wrap gap-1.5 border-b border-[#ded5f1] bg-[#f3effc] px-[13px] py-2 text-[9px] text-[#584b78] [&_span]:rounded-sm [&_span]:bg-[#e7dff8] [&_span]:px-1.5 [&_span]:py-[3px]",
  "diff-lines": "overflow-x-auto bg-paper font-mono text-[11px] leading-[1.7]",
  "diff-line":
    "grid min-h-[22px] grid-cols-[46px_46px_20px_minmax(max-content,1fr)]",
  "line-number":
    "select-none border-r border-[rgb(216_215_208/72%)] bg-[rgb(241_240_234/72%)] py-px pr-[9px] pl-1 text-right text-[9px] text-[#9ca09a]",
  "line-marker": "select-none pl-[7px] font-extrabold text-[#7f847e]",
  "line-code": "block min-w-max py-px pr-3.5 pl-0.5 whitespace-pre",
  "line-add":
    "bg-add [&_.line-number]:bg-add-strong [&_.line-number]:text-[#27805a] [&_.line-marker]:bg-add-strong [&_.line-marker]:text-[#27805a] [&_.char-change]:bg-[rgb(24_126_77/25%)] [&_.char-change]:shadow-[inset_0_-1px_rgb(16_101_59/22%)]",
  "line-remove":
    "bg-remove [&_.line-number]:bg-remove-strong [&_.line-number]:text-[#b84f42] [&_.line-marker]:bg-remove-strong [&_.line-marker]:text-[#b84f42]",
  "line-semantic": "shadow-[inset_3px_0_#9b82cf]",
  "line-move":
    "bg-[#eee8fb] shadow-[inset_3px_0_#8067bd] [&_.line-number]:bg-[#dfd5f5] [&_.line-number]:text-[#65518f] [&_.line-marker]:bg-[#dfd5f5] [&_.line-marker]:text-[#65518f] [&_.char-change]:bg-[rgb(113_84_174/20%)] [&_.char-change]:shadow-[inset_0_-1px_rgb(82_57_133/20%)]",
  "line-hunk":
    "border-y border-[#ddd7ec] bg-[#f0edf8] text-[#726a8e] [&_.line-number]:bg-[#e6e0f4] [&_.line-number]:text-transparent",
  "hunk-toggle":
    "flex min-w-max cursor-pointer items-center gap-2 border-0 bg-transparent py-px pr-3.5 pl-0.5 text-left text-[inherit] text-[#665d82] hover:text-[#403456]",
  "collapse-chevron": "inline-grid w-[15px] place-items-center text-[13px]",
  "collapsed-label":
    "rounded-sm bg-[#e3ddf2] px-[5px] py-px text-[8px] font-[720] tracking-[0.04em] text-[#756b92] uppercase",
  "inline-review-threads":
    "flex min-w-[620px] flex-col gap-2 border-y border-[#d9dce5] bg-[#f7f8fb] py-2.5 pr-3.5 pl-28 font-sans whitespace-normal",
  "detached-review-threads":
    "flex min-w-0 flex-col gap-2 border-y border-[#d9dce5] bg-[#faf9f5] px-3.5 py-2.5 font-sans whitespace-normal",
  "github-review-thread":
    "overflow-hidden rounded-[7px] border border-[#cfd3de] bg-white shadow-[0_2px_7px_rgb(16_27_44/7%)]",
  "github-review-thread-heading":
    "flex min-h-9 items-center border-b border-[#e0e3eb] bg-[#f7f8fb] pr-[11px] [.is-collapsed_&]:border-b-0",
  "github-review-thread-toggle":
    "flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch border-0 bg-transparent px-[11px] text-left text-[9px] text-[#5c6470]",
  "github-review-resolved":
    "rounded-full border border-[#a9c7b2] bg-[#e8f4eb] px-1.5 py-0.5 text-[8px] font-[720] tracking-[0.04em] text-[#267043] uppercase",
  "github-review-summary":
    "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[9px] font-normal text-[#69717d]",
  "github-review-comment":
    "px-[11px] py-[9px] [&.is-reply]:ml-6 [&.is-reply]:border-t [&.is-reply]:border-l-[3px] [&.is-reply]:border-[#e2e4eb] [&.is-reply]:border-l-[#d9dce5] [&_p]:mt-1.5 [&_p]:mb-0 [&_p]:whitespace-pre-wrap [&_p]:text-[11px] [&_p]:leading-[1.55] [&_p]:text-[#28313c]",
  "github-comment-markdown":
    "text-[11px] leading-[1.55] text-[#28313c] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_a]:text-[#315f9d] [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:my-2 [&_blockquote]:border-l-[3px] [&_blockquote]:border-[#c9cdd7] [&_blockquote]:pl-3 [&_blockquote]:text-[#5b6470] [&_h1]:my-2 [&_h1]:text-base [&_h2]:my-2 [&_h2]:text-sm [&_h3]:my-2 [&_h3]:text-xs [&_h4]:my-2 [&_h4]:text-[11px] [&_h5]:my-2 [&_h5]:text-[10px] [&_h6]:my-2 [&_h6]:text-[10px] [&_hr]:my-3 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-[#dfe2e8] [&_img]:max-w-full [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_pre]:my-2 [&_table]:my-2 [&_table]:border-collapse [&_table]:text-[10px] [&_td]:border [&_td]:border-[#d8dbe3] [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-[#d8dbe3] [&_th]:bg-[#f1f3f6] [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6",
  "markdown-inline-code":
    "rounded bg-[#eef0f4] px-1 py-0.5 font-mono text-[10px]",
  "markdown-code-block":
    "overflow-x-auto rounded-md border border-[#d8dbe3] bg-[#f5f6f8] p-2.5 font-mono text-[10px] leading-[1.5] whitespace-pre",
  "markdown-footnote":
    "mt-2 flex items-start gap-1 border-t border-[#dfe2e8] pt-2 text-[9px] text-[#606975]",
  "markdown-raw": "whitespace-pre-wrap text-[#59636f]",
  "task-list-item": "list-none [&>input]:mr-2 [&>input]:align-middle",
  "github-review-comment-header":
    "flex items-center justify-between gap-3 text-[9px] text-[#5c6470]",
  "github-review-link":
    "text-[8px] text-[#59657b] no-underline hover:underline",
  "github-reply-form":
    "grid gap-[7px] border-t border-[#e0e3eb] bg-[#f7f8fb] px-[11px] py-[9px] [&_textarea]:box-border [&_textarea]:w-full [&_textarea]:resize-y [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-[#c9cdd7] [&_textarea]:bg-white [&_textarea]:px-2.5 [&_textarea]:py-[9px] [&_textarea]:text-[11px] [&_textarea]:leading-normal [&_textarea]:text-ink [&_textarea]:outline-none [&_textarea]:focus-visible:outline-2 [&_textarea]:focus-visible:outline-offset-2 [&_textarea]:focus-visible:outline-lime [&_textarea:focus]:border-[#889655] [&_textarea:focus]:shadow-[0_0_0_3px_rgb(155_183_47/14%)]",
  "github-reply-actions": "flex items-center justify-between gap-2",
  "github-reply-button":
    "min-h-[30px] cursor-pointer rounded-[5px] border border-[#bdc2cc] bg-white px-[11px] text-[10px] font-[680] disabled:cursor-not-allowed disabled:opacity-50",
  "github-review-error": "text-[9px] text-[#9a4136]",
  "github-review-success": "text-[9px] font-[650] text-[#23633f]",
  "github-review-composer":
    "m-[18px] grid gap-[11px] rounded-lg border border-[#cfd3de] bg-[#f7f8fb] p-3.5 shadow-[0_3px_12px_rgb(16_27_44/6%)] [&>textarea]:box-border [&>textarea]:w-full [&>textarea]:resize-y [&>textarea]:rounded-md [&>textarea]:border [&>textarea]:border-[#c9cdd7] [&>textarea]:bg-white [&>textarea]:px-2.5 [&>textarea]:py-[9px] [&>textarea]:text-[11px] [&>textarea]:leading-normal [&>textarea]:text-ink [&>textarea]:outline-none [&>textarea]:focus-visible:outline-2 [&>textarea]:focus-visible:outline-offset-2 [&>textarea]:focus-visible:outline-lime [&>textarea:focus]:border-[#889655] [&>textarea:focus]:shadow-[0_0_0_3px_rgb(155_183_47/14%)]",
  "github-review-composer-heading":
    "flex items-center justify-between [&>div]:flex [&>div]:flex-col [&>div]:gap-0.5 [&_span]:text-[9px] [&_span]:text-[#727985]",
  "github-review-mark":
    "grid h-6 w-7 place-items-center rounded-[5px] bg-[#24292f] text-[8px]! font-extrabold text-white!",
  "github-review-submit-row":
    "flex items-center justify-between gap-2 [&>span]:text-[9px] [&>span]:text-[#727985]",
  "github-review-submit-actions":
    "flex items-center gap-2 [&_button]:min-h-[30px] [&_button]:cursor-pointer [&_button]:rounded-[5px] [&_button]:border [&_button]:border-[#bdc2cc] [&_button]:bg-white [&_button]:px-[11px] [&_button]:text-[10px] [&_button]:font-[680] [&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-50 [&_.request-changes-button]:border-[#d8a39b] [&_.request-changes-button]:text-[#8d372e] [&_.approve-button]:border-lime-dark [&_.approve-button]:bg-lime [&_.approve-button]:text-[#233700]",
  "char-change":
    "rounded-sm bg-[rgb(178_64_48/22%)] py-px shadow-[inset_0_-1px_rgb(126_41_30/20%)]",
  "hljs-comment": "text-[#6e7781] italic",
  "hljs-quote": "text-[#6e7781] italic",
  "hljs-keyword": "text-[#8250df]",
  "hljs-selector-tag": "text-[#8250df]",
  "hljs-literal": "text-[#8250df]",
  "hljs-type": "text-[#8250df]",
  "hljs-string": "text-[#0a3069]",
  "hljs-regexp": "text-[#0a3069]",
  "hljs-addition": "text-[#0a3069]",
  "hljs-attribute": "text-[#0a3069]",
  "hljs-number": "text-[#0550ae]",
  "hljs-symbol": "text-[#0550ae]",
  "hljs-bullet": "text-[#0550ae]",
  "hljs-link": "text-[#0550ae]",
  "hljs-title": "text-[#953800] font-[650]",
  "hljs-section": "text-[#953800] font-[650]",
  "hljs-built_in": "text-[#953800]",
  "hljs-variable": "text-[#953800]",
  "hljs-subst": "text-[#953800]",
  "hljs-property": "text-[#116329]",
  "hljs-attr": "text-[#116329]",
  "hljs-params": "text-[#116329]",
  "hljs-meta": "text-[#57606a]",
  "hljs-deletion": "text-[#cf222e]",
  "split-lines": "min-w-[850px]",
  "split-row": "grid grid-cols-2",
  "split-cell":
    "grid min-h-[22px] min-w-0 grid-cols-[46px_20px_minmax(max-content,1fr)] [&.left]:border-r [&.left]:border-[#cfd0ca] [&.line-hunk]:col-auto",
  "empty-cell":
    "bg-[#f3f2ed] shadow-[inset_12px_0_14px_-14px_rgb(16_27_44/35%)]",
  "diff-footer":
    "flex min-h-12 items-center justify-between border-t border-line bg-[#f8f7f2] px-[13px] py-2 text-[10px] text-[#999d97]",
  "empty-state": "grid min-h-[400px] place-items-center text-muted",
};

const classCache = new Map<string, string>();

const utilityClasses = (className: string) => {
  const cached = classCache.get(className);
  if (cached !== undefined) return cached;
  const expanded = className
    .trim()
    .split(/\s+/)
    .flatMap((token) => [token, utilities[token] ?? ""])
    .filter(Boolean)
    .join(" ");
  classCache.set(className, expanded);
  return expanded;
};

// Foldkit owns element construction, so this adapter adds Tailwind utilities while
// retaining short semantic tokens for state selectors and stable integration tests.
export const withTailwind = <Message>(
  html: HtmlBuilder<Message>,
): HtmlBuilder<Message> =>
  new Proxy(html, {
    get: (target, property, receiver) =>
      property === "Class"
        ? (className: string) => target.Class(utilityClasses(className))
        : Reflect.get(target, property, receiver),
  });

export const defineTailwindView = <Model, Message>(
  view: (model: Model, html: HtmlBuilder<Message>) => Html,
) =>
  Submodel.defineView<Model, Message>((model, html) =>
    view(model, withTailwind(html)),
  );
