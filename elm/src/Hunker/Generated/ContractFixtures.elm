module Hunker.Generated.ContractFixtures exposing (analysisSnapshot, pullCommits, repositoryCommits, repositoryPulls, reviewComments, reviewDocument, revisionBehind, sourceControl)


analysisSnapshot : String
analysisSnapshot =
    "{\"files\":[{\"path\":\"src/main.rs\",\"semantic\":{\"_tag\":\"Complete\",\"value\":{\"_tag\":\"Parsed\",\"language\":\"Rust\",\"semanticEqual\":false,\"changes\":[{\"_tag\":\"Renamed\",\"kind\":\"function_item\",\"oldLabel\":\"before\",\"newLabel\":\"after\",\"oldRange\":{\"startLine\":1,\"endLine\":3,\"startColumn\":1,\"endColumn\":2},\"newRange\":{\"startLine\":1,\"endLine\":3,\"startColumn\":1,\"endColumn\":2}}]}},\"syntax\":{\"_tag\":\"Complete\",\"value\":{\"old\":{\"_tag\":\"Unsupported\",\"reason\":\"Syntax highlighting is unavailable for this language.\"},\"new\":{\"_tag\":\"Unsupported\",\"reason\":\"Syntax highlighting is unavailable for this language.\"}}},\"wordDiff\":{\"_tag\":\"Complete\",\"value\":[{\"oldLine\":1,\"newLine\":1,\"oldRanges\":[{\"start\":0,\"end\":3}],\"newRanges\":[{\"start\":0,\"end\":3}]}]}}],\"moves\":[{\"fromPath\":\"src/a.rs\",\"toPath\":\"src/b.rs\",\"fromLine\":1,\"toLine\":4,\"fromLineCount\":3,\"toLineCount\":3,\"preview\":\"fn moved() {\",\"kind\":\"function_item\",\"label\":\"moved\",\"match\":\"exact\"}]}"


pullCommits : String
pullCommits =
    "{\"commits\":[{\"sha\":\"4444444444444444444444444444444444444444\",\"message\":\"Type the boundary\",\"author\":\"agent\",\"avatarUrl\":null,\"authoredAt\":\"2026-08-10T12:00:00Z\",\"htmlUrl\":\"https://github.com/acme/hunker/commit/4444444444444444444444444444444444444444\"}]}"


repositoryCommits : String
repositoryCommits =
    "{\"ref\":\"2222222222222222222222222222222222222222\",\"history\":\"shallow\",\"commits\":[{\"sha\":\"2222222222222222222222222222222222222222\",\"parents\":[\"1111111111111111111111111111111111111111\"],\"authorName\":\"Ada\",\"authorEmail\":\"ada@example.com\",\"authoredAt\":\"2026-08-10T12:00:00Z\",\"subject\":\"Keep history typed\"}]}"


repositoryPulls : String
repositoryPulls =
    "{\"state\":\"open\",\"page\":1,\"hasMore\":false,\"pullRequests\":[{\"number\":42,\"title\":\"Keep contracts typed\",\"author\":\"agent\",\"avatarUrl\":\"https://avatars.example/agent\",\"status\":\"draft\",\"updatedAt\":\"2026-08-10T12:00:00Z\",\"base\":\"main\",\"head\":\"agent:typed-contracts\",\"labels\":[\"rust\",\"elm\"]},{\"number\":41,\"title\":\"Merged earlier\",\"author\":\"ghost\",\"avatarUrl\":null,\"status\":\"merged\",\"updatedAt\":\"2026-08-09T12:00:00Z\",\"base\":\"main\",\"head\":\"ghost:older\",\"labels\":[]}]}"


reviewComments : String
reviewComments =
    "{\"comments\":[{\"id\":7,\"rootId\":7,\"path\":\"src/main.rs\",\"body\":\"Please keep this typed.\",\"author\":\"reviewer\",\"htmlUrl\":\"https://github.com/acme/hunker/pull/42#discussion_r7\",\"createdAt\":\"2026-08-10T12:00:00Z\",\"line\":12,\"side\":\"RIGHT\",\"resolved\":true}]}"


reviewDocument : String
reviewDocument =
    "{\"title\":\"Keep Rust and Elm contracts aligned\",\"author\":\"agent\",\"base\":\"main\",\"head\":\"typed-contracts\",\"files\":[{\"path\":\"src/main.rs\",\"status\":\"modified\",\"additions\":1,\"deletions\":1,\"patch\":\"@@ -1 +1 @@\\n-old\\n+new\"},{\"path\":\"src/new.rs\",\"status\":\"renamed\",\"previousPath\":\"src/old.rs\",\"additions\":0,\"deletions\":0,\"patch\":\"\"}],\"revision\":{\"baseOid\":\"1111111111111111111111111111111111111111\",\"headOid\":\"2222222222222222222222222222222222222222\",\"headRef\":\"typed-contracts\"},\"source\":{\"_tag\":\"Local\",\"path\":\"/Users/example/src/hunker\"}}"


revisionBehind : String
revisionBehind =
    "{\"source\":\"local\",\"path\":\"/Users/example/src/hunker\",\"checkedAt\":1786363200000,\"head\":{\"_tag\":\"Behind\",\"latestHeadOid\":\"3333333333333333333333333333333333333333\"}}"


sourceControl : String
sourceControl =
    "{\"status\":{\"path\":\"/Users/example/src/hunker\",\"checkout\":{\"_tag\":\"TrackingBranch\",\"name\":\"main\",\"oid\":\"2222222222222222222222222222222222222222\",\"upstream\":\"origin/main\",\"ahead\":1,\"behind\":2},\"branches\":[{\"name\":\"main\",\"presence\":\"both\"},{\"name\":\"feature/remote-only\",\"presence\":\"remote\"}],\"changes\":{\"staged\":1,\"unstaged\":2,\"untracked\":3},\"remote\":{\"_tag\":\"RemoteUnavailable\",\"checkedAt\":1786363200000,\"error\":\"Could not resolve host\"}}}"
