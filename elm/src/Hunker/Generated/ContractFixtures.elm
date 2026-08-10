module Hunker.Generated.ContractFixtures exposing (repositoryPulls, reviewComments, reviewDocument, sourceControl)


reviewDocument : String
reviewDocument =
    "{\"title\":\"Keep Rust and Elm contracts aligned\",\"repository\":\"acme/hunker\",\"number\":\"42\",\"author\":\"agent\",\"base\":\"main\",\"head\":\"typed-contracts\",\"url\":\"https://github.com/acme/hunker/pull/42\",\"files\":[{\"path\":\"src/main.rs\",\"previousPath\":null,\"status\":\"modified\",\"additions\":1,\"deletions\":1,\"patch\":\"@@ -1 +1 @@\\n-old\\n+new\"}],\"backing\":{\"_tag\":\"GitHub\",\"baseOid\":\"1111111111111111111111111111111111111111\",\"headOid\":\"2222222222222222222222222222222222222222\",\"headRef\":\"typed-contracts\"}}"


repositoryPulls : String
repositoryPulls =
    "{\"state\":\"open\",\"page\":1,\"hasMore\":false,\"pullRequests\":[{\"number\":42,\"title\":\"Keep contracts typed\",\"author\":\"agent\",\"avatarUrl\":\"https://avatars.example/agent\",\"state\":\"open\",\"draft\":false,\"updatedAt\":\"2026-08-10T12:00:00Z\",\"base\":\"main\",\"head\":\"agent:typed-contracts\",\"labels\":[\"rust\",\"elm\"]}]}"


sourceControl : String
sourceControl =
    "{\"status\":{\"path\":\"/Users/example/src/hunker\",\"checkout\":{\"_tag\":\"TrackingBranch\",\"name\":\"main\",\"oid\":\"2222222222222222222222222222222222222222\",\"upstream\":\"origin/main\",\"ahead\":1,\"behind\":2},\"branches\":[{\"name\":\"main\",\"local\":true,\"remote\":true}],\"changes\":{\"staged\":1,\"unstaged\":2,\"untracked\":3},\"remote\":{\"_tag\":\"RemoteCurrent\",\"checkedAt\":1786363200000}}}"


reviewComments : String
reviewComments =
    "{\"comments\":[{\"id\":7,\"rootId\":7,\"path\":\"src/main.rs\",\"body\":\"Please keep this typed.\",\"author\":\"reviewer\",\"htmlUrl\":\"https://github.com/acme/hunker/pull/42#discussion_r7\",\"createdAt\":\"2026-08-10T12:00:00Z\",\"line\":12,\"side\":\"RIGHT\",\"resolved\":false}]}"
