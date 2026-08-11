module MainProgramTest exposing (suite)

import Expect
import Http
import Hunker.ApiError as ApiError exposing (ApiError)
import Hunker.Effect as AppEffect
import Hunker.Page.Repository as Repository
import Hunker.Page.Review as Review
import Json.Decode as Decode
import Json.Encode as Encode
import Main
import ProgramTest
import SimulatedEffect.Cmd as SimulatedCmd
import SimulatedEffect.Http as SimulatedHttp
import SimulatedEffect.Navigation as SimulatedNavigation
import SimulatedEffect.Process as SimulatedProcess
import SimulatedEffect.Task as SimulatedTask
import Test exposing (Test, describe, test)
import Test.Html.Selector exposing (containing, disabled, tag, text)
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
                    |> ProgramTest.expectHttpRequestWasMade "GET" "/api/diff?url=https%3A%2F%2Fgithub.com%2Fexample%2Fhunker%2Fpull%2F42&refresh=https%3A%2F%2Fgithub.com%2Fexample%2Fhunker%2Fpull%2F42"
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
        , test "collapses resolved GitHub review threads by default" <|
            \() ->
                startedAt "/example/hunker/pull/42/files/src/greet.ts"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" reviewRequest reviewJson
                    |> ProgramTest.simulateHttpOk "GET" "/api/reviews?url=https%3A%2F%2Fgithub.com%2Fexample%2Fhunker%2Fpull%2F42" resolvedCommentsJson
                    |> ProgramTest.expectViewHas [ text "Resolved", text "reviewer" ]
        , test "serializes rapid review setting changes and coalesces the latest document" <|
            \() ->
                startedAt "/example/hunker/pull/42/files/src/greet.ts"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" reviewRequest reviewJson
                    |> ProgramTest.update (Main.ReviewMsg (Review.ToggledSemantic False))
                    |> ProgramTest.update (Main.ReviewMsg (Review.ToggledWhitespace False))
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
                    |> ProgramTest.simulateHttpOk "GET" sourceControlRequest (sourceControlJson 1)
                    |> ProgramTest.ensureViewHas
                        [ tag "button"
                        , containing [ text "Pulled 2 commits. Refreshing status…" ]
                        , disabled True
                        ]
                    |> ProgramTest.simulateHttpOk "GET" repositoryFilesRequest repositoryFilesJson
                    |> ProgramTest.expectViewHas
                        [ text "Pulled 2 commits."
                        , tag "button"
                        , containing [ text "Pull 1 ↓" ]
                        , disabled False
                        ]
        , test "opens a repository file without reloading the tree or Git status" <|
            \() ->
                startedAt "/mohamed-rdr/hunker"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" sourceControlRequest (sourceControlJson 2)
                    |> ProgramTest.simulateHttpOk "GET" repositoryFilesRequest repositoryFilesJson
                    |> ProgramTest.clickButton "README.md"
                    |> ProgramTest.ensureViewHas
                        [ text "Opening README.md…"
                        , text "README.md"
                        , text "Pull 2 ↓"
                        ]
                    |> ProgramTest.ensureHttpRequestWasMade "GET" repositoryFileRequest
                    |> ProgramTest.simulateHttpOk "GET" repositoryFileRequest repositoryFileJson
                    |> ProgramTest.expectViewHas
                        [ text "README.md"
                        , text "Local file contents"
                        , text "Pull 2 ↓"
                        ]
        , test "reloads the immutable file snapshot after switching branches" <|
            \() ->
                startedAt "/mohamed-rdr/hunker"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" sourceControlRequest (sourceControlJson 0)
                    |> ProgramTest.simulateHttpOk "GET" repositoryFilesRequest repositoryFilesJson
                    |> ProgramTest.update (Main.RepositoryMsg (Repository.SelectedBranch "feature"))
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


simulateEffect : AppEffect.Effect msg -> ProgramTest.SimulatedEffect msg
simulateEffect effect =
    case effect of
        AppEffect.None ->
            SimulatedCmd.none

        AppEffect.Batch effects ->
            SimulatedCmd.batch (List.map simulateEffect effects)

        AppEffect.Request request ->
            SimulatedHttp.request
                { method = request.method
                , url = request.url
                , body = SimulatedHttp.emptyBody
                , headers = []
                , expect =
                    SimulatedHttp.expectStringResponse
                        (Result.withDefault (request.onError (ApiError.transport "The simulated request failed.")))
                        (decodeResponse request.decoder request.onError >> Ok)
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

        AppEffect.After milliseconds message ->
            SimulatedTask.perform (always message) (SimulatedProcess.sleep milliseconds)


decodeResponse : Decode.Decoder msg -> (ApiError -> msg) -> Http.Response String -> msg
decodeResponse decoder onError response =
    case response of
        Http.GoodStatus_ _ body ->
            case Decode.decodeString decoder body of
                Ok message ->
                    message

                Err error ->
                    onError (ApiError.unexpectedResponse (Decode.errorToString error))

        Http.BadUrl_ url ->
            onError (ApiError.transport ("Invalid API URL: " ++ url))

        Http.Timeout_ ->
            onError (ApiError.transport "The Hunker API timed out.")

        Http.NetworkError_ ->
            onError (ApiError.transport "Could not reach the local Hunker API.")

        Http.BadStatus_ metadata body ->
            onError
                (Decode.decodeString ApiError.decoder body
                    |> Result.withDefault
                        (ApiError.unexpectedResponse
                            ("The Hunker API returned " ++ String.fromInt metadata.statusCode ++ ".")
                        )
                )


settingsJson : String
settingsJson =
    """{"settings":{"repositoriesRoot":"~/src","cacheRoot":"/tmp/hunker/repositories","reviewScope":"file","viewMode":"split","ignoreWhitespace":true,"semantic":true,"inlineDiffMode":"token","syntaxHighlighting":true,"sidebarCollapsed":false,"showGitHubReviews":true},"configPath":"/tmp/hunker/settings.json"}"""


settingsSemanticOffJson : String
settingsSemanticOffJson =
    """{"settings":{"repositoriesRoot":"~/src","cacheRoot":"/tmp/hunker/repositories","reviewScope":"file","viewMode":"split","ignoreWhitespace":true,"semantic":false,"inlineDiffMode":"token","syntaxHighlighting":true,"sidebarCollapsed":false,"showGitHubReviews":true},"configPath":"/tmp/hunker/settings.json"}"""


settingsSemanticAndWhitespaceOffJson : String
settingsSemanticAndWhitespaceOffJson =
    """{"settings":{"repositoriesRoot":"~/src","cacheRoot":"/tmp/hunker/repositories","reviewScope":"file","viewMode":"split","ignoreWhitespace":false,"semantic":false,"inlineDiffMode":"token","syntaxHighlighting":true,"sidebarCollapsed":false,"showGitHubReviews":true},"configPath":"/tmp/hunker/settings.json"}"""


repositoriesJson : String
repositoriesJson =
    """{"configuredRoot":"/Users/mohamed/src","temporaryRoot":"/tmp/hunker/repositories","repositories":[{"owner":"mohamed-rdr","name":"hunker","path":"/Users/mohamed/src/hunker","source":"configured"}]}"""


repositoryFilesJson : String
repositoryFilesJson =
    """{"files":[{"path":"README.md","size":10,"gitStatus":"clean"}]}"""


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
    """{"files":[{"path":"feature.txt","size":12,"gitStatus":"clean"}]}"""


repositoryFileRequest : String
repositoryFileRequest =
    "/api/repository/file?repository=mohamed-rdr%2Fhunker&oid=" ++ repositoryOid ++ "&path=README.md"


repositoryFileJson : String
repositoryFileJson =
    """{"path":"README.md","content":"# Local file contents
","truncated":false,"presentation":{"_tag":"Unsupported","reason":"Markdown is not highlighted."}}"""


repositoryCommitsJson : String
repositoryCommitsJson =
    """{"ref":"main","shallow":false,"commits":[{"sha":"1111111111111111111111111111111111111111","parents":[],"subject":"A stale commit","authorName":"Mohamed","authorEmail":"mohamed@example.com","authoredAt":"2026-08-10T00:00:00Z"}]}"""


repositoryCommitsRequest : String
repositoryCommitsRequest =
    "/api/repository/commits?repository=mohamed-rdr%2Fhunker&oid=" ++ repositoryOid


repositoryPullsJson : String
repositoryPullsJson =
    """{"state":"open","page":1,"hasMore":false,"pullRequests":[{"number":7,"title":"Remote pull request","author":"agent","avatarUrl":"","state":"open","draft":false,"updatedAt":"2026-08-10T00:00:00Z","base":"main","head":"feature","labels":[]}]}"""


sourceControlRequest : String
sourceControlRequest =
    "/api/repository/source-control?repository=mohamed-rdr%2Fhunker"


sourceControlJson : Int -> String
sourceControlJson behind =
    sourceControlAt "main" repositoryOid behind


sourceControlAt : String -> String -> Int -> String
sourceControlAt branch oid behind =
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
                                , ( "local", Encode.bool True )
                                , ( "remote", Encode.bool True )
                                ]
                            , Encode.object
                                [ ( "name", Encode.string "feature" )
                                , ( "local", Encode.bool True )
                                , ( "remote", Encode.bool True )
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
                    , ( "remote"
                      , Encode.object
                            [ ( "_tag", Encode.string "RemoteCurrent" )
                            , ( "checkedAt", Encode.int 1 )
                            ]
                      )
                    ]
              )
            ]


reviewRequest : String
reviewRequest =
    "/api/diff?url=https%3A%2F%2Fgithub.com%2Fexample%2Fhunker%2Fpull%2F42&refresh=https%3A%2F%2Fgithub.com%2Fexample%2Fhunker%2Fpull%2F42"


reviewJson : String
reviewJson =
    Encode.encode 0 <|
        Encode.object
            [ ( "title", Encode.string "Improve the greeting" )
            , ( "repository", Encode.string "example/hunker" )
            , ( "number", Encode.string "42" )
            , ( "author", Encode.string "agent" )
            , ( "base", Encode.string "main" )
            , ( "head", Encode.string "feature/greeting" )
            , ( "url", Encode.string "https://github.com/example/hunker/pull/42" )
            , ( "files"
              , Encode.list identity
                    [ Encode.object
                        [ ( "path", Encode.string "src/greet.ts" )
                        , ( "previousPath", Encode.null )
                        , ( "status", Encode.string "modified" )
                        , ( "additions", Encode.int 1 )
                        , ( "deletions", Encode.int 1 )
                        , ( "patch", Encode.string "@@ -1 +1 @@\n-const greeting = \"hi\";\n+const greeting = \"hello\";" )
                        ]
                    ]
              )
            , ( "backing"
              , Encode.object
                    [ ( "_tag", Encode.string "GitHub" )
                    , ( "baseOid", Encode.string "1111111111111111111111111111111111111111" )
                    , ( "headOid", Encode.string "2222222222222222222222222222222222222222" )
                    , ( "headRef", Encode.string "feature/greeting" )
                    , ( "path", Encode.string "" )
                    ]
              )
            ]


resolvedCommentsJson : String
resolvedCommentsJson =
    """{"comments":[{"id":7,"rootId":7,"path":"src/greet.ts","body":"This **thread** is resolved.","author":"reviewer","htmlUrl":"https://github.com/example/hunker/pull/42#discussion_r7","createdAt":"2026-08-07T12:00:00Z","line":1,"side":"RIGHT","resolved":true}]}"""
