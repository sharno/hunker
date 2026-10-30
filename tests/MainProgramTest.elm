module MainProgramTest exposing (suite)

import Expect
import Html.Attributes
import Hunker.Domain.Git as Git
import Hunker.Domain.Settings as Settings
import Hunker.Effect as AppEffect
import Hunker.Page.Repository as Repository
import Hunker.Page.Review as Review
import Json.Encode as Encode
import Main
import ProgramTest
import SimulatedEffect.Cmd as SimulatedCmd
import SimulatedEffect.Http as SimulatedHttp
import SimulatedEffect.Navigation as SimulatedNavigation
import SimulatedEffect.Process as SimulatedProcess
import SimulatedEffect.Task as SimulatedTask
import Test exposing (Test, describe, test)
import Test.Html.Query as Query
import Test.Html.Selector exposing (attribute, class, containing, disabled, tag, text)
import Test.Http as TestHttp
import Time


suite : Test
suite =
    describe "Hunker Elm program"
        [ test "boots from server settings and renders the local repository catalog" <|
            \() ->
                started
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" "/api/repositories" repositoriesJson
                    |> ProgramTest.expectViewHas [ text "Repositories", text "mohamed-rdr/hunker" ]
        , test "keeps boot failure as an explicit state and can retry" <|
            \() ->
                started
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" "{}"
                    |> ProgramTest.ensureViewHas [ text "Could not load Hunker settings" ]
                    |> ProgramTest.clickButton "Try again"
                    |> ProgramTest.expectHttpRequestWasMade "GET" "/api/settings"
        , test "parses a pasted GitHub pull request into the canonical Hunker route" <|
            \() ->
                started
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" "/api/repositories" repositoriesJson
                    |> ProgramTest.update (Main.ChangedGitHubInput "https://github.com/example/hunker/pull/42")
                    |> ProgramTest.clickButton "Open"
                    |> ProgramTest.ensureViewHas [ text "Loading the latest change…", text "example/hunker/pull/42" ]
                    |> ProgramTest.expectHttpRequestWasMade "GET" reviewRequest
        , test "renders a loaded review and auto-collapses a reviewed file" <|
            \() ->
                startedAt "/example/hunker/pull/42/files/src/greet.ts"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.ensureViewHas [ text "Loading the latest change…" ]
                    |> ProgramTest.simulateHttpOk "GET" reviewRequest reviewJson
                    |> ProgramTest.ensureViewHas
                        [ text "Improve the greeting"
                        , text "src/greet.ts"
                        , text "hello"
                        ]
                    |> ProgramTest.clickButton "Mark reviewed"
                    |> ProgramTest.expectViewHas [ text "Reviewed" ]
        , test "a commit inside a pull request is pinned: no head check, threads, or composer" <|
            \() ->
                startedAt ("/example/hunker/pull/42/commits/" ++ headOid)
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" ("/api/diff?url=https%3A%2F%2Fgithub.com%2Fexample%2Fhunker%2Fcommit%2F" ++ headOid) reviewJson
                    |> ProgramTest.ensureViewHas [ text "agent committed ", text "2222222" ]
                    |> ProgramTest.ensureViewHasNot [ text "Submit review" ]
                    |> ProgramTest.ensureHttpRequests "GET" ("/api/revision?url=https%3A%2F%2Fgithub.com%2Fexample%2Fhunker%2Fpull%2F42&headOid=" ++ headOid) (List.length >> Expect.equal 0)
                    |> ProgramTest.ensureHttpRequests "GET" "/api/commits?url=https%3A%2F%2Fgithub.com%2Fexample%2Fhunker%2Fpull%2F42" (List.length >> Expect.equal 0)
                    |> ProgramTest.expectHttpRequests "GET" "/api/reviews?url=https%3A%2F%2Fgithub.com%2Fexample%2Fhunker%2Fpull%2F42" (List.length >> Expect.equal 0)
        , test "turning off diff colors marks the diff section" <|
            \() ->
                startedAt "/example/hunker/pull/42/files/src/greet.ts"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" reviewRequest reviewJson
                    |> ProgramTest.update (reviewSetting (Settings.SetDiffColors Settings.Disabled))
                    |> ProgramTest.expectView (Query.find [ class "review-diffs" ] >> Query.has [ class "diff-colors-disabled" ])
        , test "the full-diff scope renders every file panel" <|
            \() ->
                startedAt "/example/hunker/pull/42/files/src/greet.ts"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" reviewRequest reviewJson
                    |> ProgramTest.ensureView (Query.findAll [ class "diff-panel" ] >> Query.count (Expect.equal 1))
                    |> ProgramTest.update (reviewSetting (Settings.SetReviewScope Settings.FullDiff))
                    |> ProgramTest.expectView (Query.findAll [ class "diff-panel" ] >> Query.count (Expect.equal 2))
        , test "renders review analysis progress once and clears it when the snapshot arrives" <|
            \() ->
                startedAt "/example/hunker/pull/42/files/src/greet.ts"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" reviewRequest reviewJson
                    |> ProgramTest.update (reviewSetting (Settings.SetReviewScope Settings.FullDiff))
                    |> ProgramTest.ensureView (Query.findAll [ class "review-analysis-status" ] >> Query.count (Expect.equal 1))
                    |> ProgramTest.simulateHttpOk "GET" analysisRequest analysisJson
                    |> ProgramTest.expectView (Query.findAll [ class "review-analysis-status" ] >> Query.count (Expect.equal 0))
        , test "collapses resolved GitHub review threads by default" <|
            \() ->
                startedAt "/example/hunker/pull/42/files/src/greet.ts"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" reviewRequest reviewJson
                    |> ProgramTest.simulateHttpOk "GET" "/api/reviews?url=https%3A%2F%2Fgithub.com%2Fexample%2Fhunker%2Fpull%2F42" resolvedCommentsJson
                    |> ProgramTest.expectViewHas [ text "Resolved", text "reviewer" ]
        , test "disables full-file expansion while its request is active" <|
            \() ->
                startedAt "/example/hunker/pull/42/files/src/greet.ts"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" reviewRequest reviewJson
                    |> ProgramTest.clickButton "Full file"
                    |> ProgramTest.expectViewHas
                        [ tag "button"
                        , containing [ text "Loading…" ]
                        , disabled True
                        ]
        , test "exposes approval progress and success instead of submitting invisibly" <|
            \() ->
                startedAt "/example/hunker/pull/42/files/src/greet.ts"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" reviewRequest reviewJson
                    |> ProgramTest.clickButton "Approve"
                    |> ProgramTest.ensureViewHas
                        [ tag "button"
                        , containing [ text "Approving…" ]
                        , disabled True
                        ]
                    |> ProgramTest.ensureViewHas
                        [ tag "button"
                        , containing [ text "Comment" ]
                        , disabled True
                        ]
                    |> ProgramTest.ensureHttpRequests "POST" "/api/reviews/submit" (List.length >> Expect.equal 1)
                    |> ProgramTest.simulateHttpOk "POST" "/api/reviews/submit" "{\"event\":\"APPROVE\"}"
                    |> ProgramTest.expectViewHas [ text "Review approved on GitHub." ]
        , test "serializes rapid review setting changes and coalesces the latest document" <|
            \() ->
                startedAt "/example/hunker/pull/42/files/src/greet.ts"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" reviewRequest reviewJson
                    |> ProgramTest.update (reviewSetting (Settings.SetSemantic Settings.Disabled))
                    |> ProgramTest.update (reviewSetting (Settings.SetWhitespace Settings.ShowWhitespace))
                    |> ProgramTest.ensureHttpRequests "PUT" "/api/settings" (List.length >> Expect.equal 1)
                    |> ProgramTest.simulateHttpOk "PUT" "/api/settings" settingsSemanticOffJson
                    |> ProgramTest.ensureHttpRequests "PUT" "/api/settings" (List.length >> Expect.equal 1)
                    |> ProgramTest.simulateHttpOk "PUT" "/api/settings" settingsSemanticAndWhitespaceOffJson
                    |> ProgramTest.expectViewHas [ text "Improve the greeting" ]
        , test "keeps pull disabled until a separate Git status refresh replaces the stale count" <|
            \() ->
                startedAt "/mohamed-rdr/hunker"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" sourceControlRequest (sourceControlJson 2)
                    |> ProgramTest.simulateHttpOk "GET" repositoryFilesRequest repositoryFilesJson
                    |> ProgramTest.simulateHttpOk "POST" fetchRequest (sourceControlJson 2)
                    |> ProgramTest.clickButton "Pull 2 ↓"
                    |> ProgramTest.update (Main.RepositoryMsg (Repository.PollSourceControl (Time.millisToPosix 120000)))
                    |> ProgramTest.ensureViewHas
                        [ tag "button"
                        , containing [ text "Pulling…" ]
                        , disabled True
                        ]
                    |> ProgramTest.simulateHttpOk "POST" "/api/repository/pull" "{\"pulledCommits\":2}"
                    |> ProgramTest.ensureViewHas
                        [ tag "button"
                        , containing [ text "Pulled 2 commits. Refreshing status…" ]
                        , disabled True
                        ]
                    |> ProgramTest.ensureHttpRequestWasMade "GET" sourceControlRequest
                    |> ProgramTest.simulateHttpOk "GET" sourceControlRequest (sourceControlAt "main" featureOid 1)
                    |> ProgramTest.ensureViewHas
                        [ tag "button"
                        , containing [ text "Pulled 2 commits. Refreshing status…" ]
                        , disabled True
                        ]
                    |> ProgramTest.simulateHttpOk "GET" featureFilesRequest featureFilesJson
                    |> ProgramTest.expectViewHas
                        [ text "Pulled 2 commits."
                        , tag "button"
                        , containing [ text "Pull 1 ↓" ]
                        , disabled False
                        ]
        , test "opens the file tree from local Git while origin is fetched in the background" <|
            \() ->
                startedAt "/mohamed-rdr/hunker"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" sourceControlRequest (sourceControlWith "main" repositoryOid 0 remoteNotChecked)
                    |> ProgramTest.simulateHttpOk "GET" repositoryFilesRequest repositoryFilesJson
                    |> ProgramTest.ensureViewHas [ text "README.md" ]
                    |> ProgramTest.ensureViewHas
                        [ tag "button"
                        , attribute (Html.Attributes.attribute "aria-label" "Fetching from origin")
                        , disabled True
                        ]
                    |> ProgramTest.simulateHttpOk "POST"
                        fetchRequest
                        (sourceControlWith "main"
                            repositoryOid
                            0
                            (Encode.object
                                [ ( "_tag", Encode.string "Unavailable" )
                                , ( "checkedAt", Encode.int 1 )
                                , ( "error", Encode.string "Could not resolve host" )
                                ]
                            )
                        )
                    |> ProgramTest.expectViewHas [ text "Origin unreachable", text "README.md" ]
        , test "opens a repository file without reloading the tree or Git status" <|
            \() ->
                startedAt "/mohamed-rdr/hunker"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" sourceControlRequest (sourceControlJson 2)
                    |> ProgramTest.simulateHttpOk "GET" repositoryFilesRequest repositoryFilesJson
                    |> ProgramTest.simulateHttpOk "POST" fetchRequest (sourceControlJson 2)
                    |> ProgramTest.clickButton "README.md"
                    |> ProgramTest.ensureViewHas
                        [ text "Opening README.md…"
                        , text "README.md"
                        , text "Pull 2 ↓"
                        ]
                    |> ProgramTest.ensureHttpRequestWasMade "GET" repositoryFileRequest
                    |> ProgramTest.simulateHttpOk "GET" repositoryFileRequest repositoryFileJson
                    |> ProgramTest.ensureViewHasNot [ text "Could not open file" ]
                    |> ProgramTest.expectViewHas
                        [ text "README.md"
                        , text "# Local file contents"
                        , text "Pull 2 ↓"
                        ]
        , test "opens a content search hit at its matched line" <|
            \() ->
                startedAt "/mohamed-rdr/hunker/tree/main?q=Local"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" sourceControlRequest (sourceControlJson 0)
                    |> ProgramTest.simulateHttpOk "GET" repositoryFilesRequest repositoryFilesJson
                    |> ProgramTest.simulateHttpOk "POST" fetchRequest (sourceControlJson 0)
                    |> ProgramTest.simulateHttpOk "GET"
                        ("/api/repository/search?repository=mohamed-rdr%2Fhunker&oid=" ++ repositoryOid ++ "&query=Local&mode=literal")
                        """{"files":[],"matches":[{"path":"README.md","line":1,"column":3,"lineContent":"# Local file contents","contextBefore":[],"contextAfter":[],"ranges":[[2,7]]}]}"""
                    |> ProgramTest.ensureViewHas [ tag "mark", containing [ text "Local" ] ]
                    |> ProgramTest.clickButton ":1"
                    |> ProgramTest.ensureBrowserUrl (Expect.equal "http://localhost:8787/mohamed-rdr/hunker/blob/main/README.md?q=Local#L1")
                    |> ProgramTest.simulateHttpOk "GET" repositoryFileRequest repositoryFileJson
                    |> ProgramTest.expectView (Query.find [ class "is-target" ] >> Query.has [ text "# Local file contents" ])
        , test "a background status poll keeps the open file and its tree" <|
            \() ->
                startedAt "/mohamed-rdr/hunker/blob/main/README.md"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" sourceControlRequest (sourceControlJson 0)
                    |> ProgramTest.simulateHttpOk "GET" repositoryFilesRequest repositoryFilesJson
                    |> ProgramTest.simulateHttpOk "POST" fetchRequest (sourceControlJson 0)
                    |> ProgramTest.simulateHttpOk "GET" repositoryFileRequest repositoryFileJson
                    |> ProgramTest.update (Main.RepositoryMsg (Repository.PollSourceControl (Time.millisToPosix 120000)))
                    |> ProgramTest.simulateHttpOk "POST" fetchRequest (sourceControlJson 0)
                    |> ProgramTest.ensureViewHasNot [ text "Repository refreshed.", text "Could not open file" ]
                    |> ProgramTest.expectViewHas [ text "# Local file contents" ]
        , test "a refused branch switch keeps the checkout controls" <|
            \() ->
                startedAt "/mohamed-rdr/hunker"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" sourceControlRequest (sourceControlJson 0)
                    |> ProgramTest.simulateHttpOk "GET" repositoryFilesRequest repositoryFilesJson
                    |> ProgramTest.simulateHttpOk "POST" fetchRequest (sourceControlJson 0)
                    |> ProgramTest.update (Main.RepositoryMsg (Repository.SelectedBranch (Git.branchName "feature")))
                    |> ProgramTest.simulateHttpResponse "POST"
                        "/api/repository/branch"
                        (TestHttp.httpResponse
                            { statusCode = 409
                            , headers = []
                            , body = """{"code":"conflict","message":"Your local changes would be overwritten.","retryable":false}"""
                            }
                        )
                    |> ProgramTest.expectViewHas
                        [ text "Could not switch to feature: Your local changes would be overwritten."
                        , text "README.md"
                        ]
        , test "reports a failed settings save outside the settings page" <|
            \() ->
                startedAt "/example/hunker/pull/42/files/src/greet.ts"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" reviewRequest reviewJson
                    |> ProgramTest.update (reviewSetting (Settings.SetDiffColors Settings.Disabled))
                    |> ProgramTest.simulateHttpResponse "PUT"
                        "/api/settings"
                        (TestHttp.httpResponse
                            { statusCode = 500
                            , headers = []
                            , body = """{"code":"internal","message":"Could not write the settings file.","retryable":false}"""
                            }
                        )
                    |> ProgramTest.expectViewHas [ text "Could not save settings: Could not write the settings file." ]
        , test "reloads the immutable file snapshot after switching branches" <|
            \() ->
                startedAt "/mohamed-rdr/hunker"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" sourceControlRequest (sourceControlJson 0)
                    |> ProgramTest.simulateHttpOk "GET" repositoryFilesRequest repositoryFilesJson
                    |> ProgramTest.simulateHttpOk "POST" fetchRequest (sourceControlJson 0)
                    |> ProgramTest.update (Main.RepositoryMsg (Repository.SelectedBranch (Git.branchName "feature")))
                    |> ProgramTest.simulateHttpOk "POST" "/api/repository/branch" (sourceControlAt "feature" featureOid 0)
                    |> ProgramTest.ensureViewHas [ text "Reading repository files…" ]
                    |> ProgramTest.simulateHttpOk "GET" featureFilesRequest featureFilesJson
                    |> ProgramTest.expectViewHas [ text "feature.txt", text "Switched to feature." ]
        , test "shows the structured server message for a repository conflict" <|
            \() ->
                startedAt "/mohamed-rdr/hunker"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpResponse "GET"
                        sourceControlRequest
                        (TestHttp.httpResponse
                            { statusCode = 409
                            , headers = []
                            , body = """{"code":"conflict","message":"Commit or stash staged changes before pulling.","retryable":false}"""
                            }
                        )
                    |> ProgramTest.ensureViewHas [ text "Commit or stash staged changes before pulling." ]
                    |> ProgramTest.expectViewHasNot [ text "Clone to /tmp" ]
        , test "offers cloning only when the local repository is missing" <|
            \() ->
                startedAt "/example/missing"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpResponse "GET"
                        "/api/repository/source-control?repository=example%2Fmissing"
                        (TestHttp.httpResponse
                            { statusCode = 404
                            , headers = []
                            , body = """{"code":"not_found","message":"Local repository not found for example/missing.","retryable":false}"""
                            }
                        )
                    |> ProgramTest.expectViewHas [ text "Clone to /tmp", text "Clone to repos root" ]
        , test "does not render a stale commits response after returning to files" <|
            \() ->
                startedAt "/mohamed-rdr/hunker"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" sourceControlRequest (sourceControlJson 0)
                    |> ProgramTest.simulateHttpOk "GET" repositoryFilesRequest repositoryFilesJson
                    |> ProgramTest.clickButton "Commits"
                    |> ProgramTest.clickButton "Files"
                    |> ProgramTest.simulateHttpOk "GET" repositoryCommitsRequest repositoryCommitsJson
                    |> ProgramTest.expectViewHas [ text "Choose a file" ]
        , test "loads GitHub pull requests even when the repository is not cloned" <|
            \() ->
                startedAt "/example/missing/pulls"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpResponse "GET"
                        "/api/repository/source-control?repository=example%2Fmissing"
                        (TestHttp.httpResponse
                            { statusCode = 404
                            , headers = []
                            , body = """{"code":"not_found","message":"Local repository not found for example/missing.","retryable":false}"""
                            }
                        )
                    |> ProgramTest.simulateHttpOk "GET" "/api/repository/pulls?repository=example%2Fmissing&state=open&page=1" repositoryPullsJson
                    |> ProgramTest.expectViewHas [ text "Pull requests for example/missing", text "Remote pull request" ]
        ]


started : ProgramTest.ProgramTest Main.Model Main.Msg (AppEffect.Effect Main.Msg)
started =
    startedAt "/"


startedAt : String -> ProgramTest.ProgramTest Main.Model Main.Msg (AppEffect.Effect Main.Msg)
startedAt path =
    ProgramTest.createApplication
        { init = Main.init
        , onUrlChange = Main.UrlChanged
        , onUrlRequest = Main.LinkClicked
        , update = Main.update
        , view = Main.view
        }
        |> ProgramTest.withBaseUrl ("http://localhost:8787" ++ path)
        |> ProgramTest.withSimulatedEffects simulateEffect
        |> ProgramTest.start ()


settled : Result msg msg -> msg
settled result =
    case result of
        Ok message ->
            message

        Err message ->
            message


reviewSetting : Settings.Change -> Main.Msg
reviewSetting change =
    Main.ReviewMsg (Review.ReadyMsg (Review.ChangedSetting change))


{-| Interprets the real `Hunker.Effect` ADT, including request bodies and the
shared response decoding.
-}
simulateEffect : AppEffect.Effect msg -> ProgramTest.SimulatedEffect msg
simulateEffect effect =
    case effect of
        AppEffect.None ->
            SimulatedCmd.none

        AppEffect.Batch effects ->
            SimulatedCmd.batch (List.map simulateEffect effects)

        AppEffect.Request request ->
            SimulatedHttp.request
                { method = AppEffect.methodName request.method
                , url = request.url
                , body =
                    case request.body of
                        AppEffect.EmptyBody ->
                            SimulatedHttp.emptyBody

                        AppEffect.JsonBody value ->
                            SimulatedHttp.jsonBody value
                , headers = []
                , expect = SimulatedHttp.expectStringResponse settled (AppEffect.responseToMessage request >> Ok)
                , timeout = Nothing
                , tracker = Nothing
                }

        AppEffect.PushUrl url ->
            SimulatedNavigation.pushUrl url

        AppEffect.ReplaceUrl url ->
            SimulatedNavigation.replaceUrl url

        AppEffect.LoadExternal url ->
            SimulatedNavigation.load url

        AppEffect.Focus _ message ->
            SimulatedTask.perform identity (SimulatedTask.succeed message)

        AppEffect.ScrollIntoView _ message ->
            SimulatedTask.perform identity (SimulatedTask.succeed message)

        AppEffect.ResetViewport message ->
            SimulatedTask.perform identity (SimulatedTask.succeed message)

        AppEffect.After milliseconds message ->
            SimulatedTask.perform (always message) (SimulatedProcess.sleep milliseconds)


settingsJson : String
settingsJson =
    """{"settings":{"repositoriesRoot":"~/src","cacheRoot":"/tmp/hunker/repositories","reviewScope":"file","viewMode":"split","ignoreWhitespace":true,"semantic":true,"inlineDiffMode":"token","syntaxHighlighting":true,"diffColors":true,"sidebarCollapsed":false,"showGitHubReviews":true,"topBarCollapsed":false},"configPath":"/tmp/hunker/settings.json"}"""


settingsSemanticOffJson : String
settingsSemanticOffJson =
    """{"settings":{"repositoriesRoot":"~/src","cacheRoot":"/tmp/hunker/repositories","reviewScope":"file","viewMode":"split","ignoreWhitespace":true,"semantic":false,"inlineDiffMode":"token","syntaxHighlighting":true,"diffColors":true,"sidebarCollapsed":false,"showGitHubReviews":true,"topBarCollapsed":false},"configPath":"/tmp/hunker/settings.json"}"""


settingsSemanticAndWhitespaceOffJson : String
settingsSemanticAndWhitespaceOffJson =
    """{"settings":{"repositoriesRoot":"~/src","cacheRoot":"/tmp/hunker/repositories","reviewScope":"file","viewMode":"split","ignoreWhitespace":false,"semantic":false,"inlineDiffMode":"token","syntaxHighlighting":true,"diffColors":true,"sidebarCollapsed":false,"showGitHubReviews":true,"topBarCollapsed":false},"configPath":"/tmp/hunker/settings.json"}"""


repositoriesJson : String
repositoriesJson =
    """{"configuredRoot":"/Users/mohamed/src","temporaryRoot":"/tmp/hunker/repositories","repositories":[{"owner":"mohamed-rdr","name":"hunker","path":"/Users/mohamed/src/hunker","source":"configured"}]}"""


repositoryFilesJson : String
repositoryFilesJson =
    """{"files":[{"path":"README.md","size":10}]}"""


repositoryOid : String
repositoryOid =
    "2222222222222222222222222222222222222222"


repositoryFilesRequest : String
repositoryFilesRequest =
    "/api/repository/files?repository=mohamed-rdr%2Fhunker&oid=" ++ repositoryOid


featureOid : String
featureOid =
    "3333333333333333333333333333333333333333"


featureFilesRequest : String
featureFilesRequest =
    "/api/repository/files?repository=mohamed-rdr%2Fhunker&oid=" ++ featureOid


featureFilesJson : String
featureFilesJson =
    """{"files":[{"path":"feature.txt","size":12}]}"""


repositoryFileRequest : String
repositoryFileRequest =
    "/api/repository/file?repository=mohamed-rdr%2Fhunker&oid=" ++ repositoryOid ++ "&path=README.md"


repositoryFileJson : String
repositoryFileJson =
    Encode.encode 0 <|
        Encode.object
            [ ( "path", Encode.string "README.md" )
            , ( "content", Encode.string "# Local file contents\n" )
            , ( "truncated", Encode.bool False )
            , ( "presentation"
              , Encode.object
                    [ ( "_tag", Encode.string "Unsupported" )
                    , ( "reason", Encode.string "Markdown is not highlighted." )
                    ]
              )
            ]


repositoryCommitsJson : String
repositoryCommitsJson =
    """{"ref":"2222222222222222222222222222222222222222","history":"complete","commits":[{"sha":"1111111111111111111111111111111111111111","parents":[],"subject":"A stale commit","authorName":"Mohamed","authorEmail":"mohamed@example.com","authoredAt":1786320000000}]}"""


repositoryCommitsRequest : String
repositoryCommitsRequest =
    "/api/repository/commits?repository=mohamed-rdr%2Fhunker&oid=" ++ repositoryOid


repositoryPullsJson : String
repositoryPullsJson =
    """{"state":"open","page":1,"hasMore":false,"pullRequests":[{"number":7,"title":"Remote pull request","author":"agent","avatarUrl":null,"status":"open","updatedAt":1786320000000,"base":"main","head":"feature","labels":[]}]}"""


sourceControlRequest : String
sourceControlRequest =
    "/api/repository/source-control?repository=mohamed-rdr%2Fhunker"


sourceControlJson : Int -> String
sourceControlJson behind =
    sourceControlAt "main" repositoryOid behind


fetchRequest : String
fetchRequest =
    "/api/repository/fetch"


sourceControlAt : String -> String -> Int -> String
sourceControlAt branch oid behind =
    sourceControlWith branch
        oid
        behind
        (Encode.object
            [ ( "_tag", Encode.string "Current" )
            , ( "checkedAt", Encode.int 1 )
            ]
        )


remoteNotChecked : Encode.Value
remoteNotChecked =
    Encode.object [ ( "_tag", Encode.string "NotChecked" ) ]


sourceControlWith : String -> String -> Int -> Encode.Value -> String
sourceControlWith branch oid behind remote =
    Encode.encode 0 <|
        Encode.object
            [ ( "status"
              , Encode.object
                    [ ( "path", Encode.string "/Users/mohamed/src/hunker" )
                    , ( "checkout"
                      , Encode.object
                            [ ( "_tag", Encode.string "TrackingBranch" )
                            , ( "name", Encode.string branch )
                            , ( "oid", Encode.string oid )
                            , ( "upstream", Encode.string ("origin/" ++ branch) )
                            , ( "ahead", Encode.int 0 )
                            , ( "behind", Encode.int behind )
                            ]
                      )
                    , ( "branches"
                      , Encode.list identity
                            [ Encode.object
                                [ ( "name", Encode.string "main" )
                                , ( "presence", Encode.string "both" )
                                ]
                            , Encode.object
                                [ ( "name", Encode.string "feature" )
                                , ( "presence", Encode.string "both" )
                                ]
                            ]
                      )
                    , ( "changes"
                      , Encode.object
                            [ ( "staged", Encode.int 0 )
                            , ( "unstaged", Encode.int 0 )
                            , ( "untracked", Encode.int 0 )
                            ]
                      )
                    , ( "remote", remote )
                    ]
              )
            ]


headOid : String
headOid =
    "2222222222222222222222222222222222222222"


reviewRequest : String
reviewRequest =
    "/api/diff?url=https%3A%2F%2Fgithub.com%2Fexample%2Fhunker%2Fpull%2F42"


reviewJson : String
reviewJson =
    Encode.encode 0 <|
        Encode.object
            [ ( "title", Encode.string "Improve the greeting" )
            , ( "author", Encode.string "agent" )
            , ( "base", Encode.string "main" )
            , ( "head", Encode.string "feature/greeting" )
            , ( "files"
              , Encode.list identity
                    [ Encode.object
                        [ ( "path", Encode.string "src/greet.ts" )
                        , ( "status", Encode.string "modified" )
                        , ( "additions", Encode.int 1 )
                        , ( "deletions", Encode.int 1 )
                        , ( "patch", Encode.string "@@ -1 +1 @@\n-const greeting = \"hi\";\n+const greeting = \"hello\";" )
                        ]
                    , Encode.object
                        [ ( "path", Encode.string "src/other.ts" )
                        , ( "status", Encode.string "modified" )
                        , ( "additions", Encode.int 1 )
                        , ( "deletions", Encode.int 1 )
                        , ( "patch", Encode.string "@@ -1 +1 @@\n-export const other = false;\n+export const other = true;" )
                        ]
                    ]
              )
            , ( "revision"
              , Encode.object
                    [ ( "baseOid", Encode.string "1111111111111111111111111111111111111111" )
                    , ( "headOid", Encode.string "2222222222222222222222222222222222222222" )
                    , ( "headRef", Encode.string "feature/greeting" )
                    ]
              )
            , ( "source", Encode.object [ ( "_tag", Encode.string "GitHub" ) ] )
            ]


analysisRequest : String
analysisRequest =
    "/api/analysis?url=https%3A%2F%2Fgithub.com%2Fexample%2Fhunker%2Fpull%2F42&baseOid=1111111111111111111111111111111111111111&headOid=2222222222222222222222222222222222222222&whitespace=ignore&semantic=enabled&syntax=enabled&inlineDiff=token"


analysisJson : String
analysisJson =
    """{"files":[],"moves":[]}"""


resolvedCommentsJson : String
resolvedCommentsJson =
    """{"comments":[{"id":7,"rootId":7,"path":"src/greet.ts","body":"This **thread** is resolved.","author":"reviewer","htmlUrl":"https://github.com/example/hunker/pull/42#discussion_r7","createdAt":1786104000000,"anchor":{"_tag":"Current","line":1,"side":"RIGHT"},"resolved":true}]}"""
