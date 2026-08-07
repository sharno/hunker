module MainProgramTest exposing (suite)

import Http
import Hunker.Effect as AppEffect
import Hunker.Page.Repository as Repository
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
        , test "keeps pull disabled until a separate Git status refresh replaces the stale count" <|
            \() ->
                startedAt "/mohamed-rdr/hunker"
                    |> ProgramTest.simulateHttpOk "GET" "/api/settings" settingsJson
                    |> ProgramTest.simulateHttpOk "GET" "/api/repository/files?repository=mohamed-rdr%2Fhunker" repositoryFilesJson
                    |> ProgramTest.simulateHttpOk "GET" sourceControlRequest (sourceControlJson 2)
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
                    |> ProgramTest.simulateHttpOk "GET" "/api/repository/files?repository=mohamed-rdr%2Fhunker" repositoryFilesJson
                    |> ProgramTest.simulateHttpOk "GET" sourceControlRequest (sourceControlJson 2)
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
                        (Result.withDefault (request.onError "The simulated request failed."))
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

        AppEffect.After milliseconds message ->
            SimulatedTask.perform (always message) (SimulatedProcess.sleep milliseconds)


decodeResponse : Decode.Decoder msg -> (String -> msg) -> Http.Response String -> msg
decodeResponse decoder onError response =
    case response of
        Http.GoodStatus_ _ body ->
            case Decode.decodeString decoder body of
                Ok message ->
                    message

                Err error ->
                    onError (Decode.errorToString error)

        Http.BadUrl_ url ->
            onError ("Invalid API URL: " ++ url)

        Http.Timeout_ ->
            onError "The Hunker API timed out."

        Http.NetworkError_ ->
            onError "Could not reach the local Hunker API."

        Http.BadStatus_ metadata _ ->
            onError ("The Hunker API returned " ++ String.fromInt metadata.statusCode ++ ".")


settingsJson : String
settingsJson =
    """{"settings":{"repositoriesRoot":"~/src","cacheRoot":"/tmp/hunker/repositories","reviewScope":"file","viewMode":"split","ignoreWhitespace":true,"semantic":true,"inlineDiffMode":"token","syntaxHighlighting":true,"sidebarCollapsed":false,"showGitHubReviews":true},"configPath":"/tmp/hunker/settings.json"}"""


repositoriesJson : String
repositoriesJson =
    """{"configuredRoot":"/Users/mohamed/src","temporaryRoot":"/tmp/hunker/repositories","repositories":[{"owner":"mohamed-rdr","name":"hunker","path":"/Users/mohamed/src/hunker","source":"configured"}]}"""


repositoryFilesJson : String
repositoryFilesJson =
    """{"files":[{"path":"README.md","size":10,"gitStatus":"clean"}]}"""


repositoryFileRequest : String
repositoryFileRequest =
    "/api/repository/file?repository=mohamed-rdr%2Fhunker&path=README.md"


repositoryFileJson : String
repositoryFileJson =
    """{"path":"README.md","content":"# Local file contents
","truncated":false}"""


sourceControlRequest : String
sourceControlRequest =
    "/api/repository/source-control?repository=mohamed-rdr%2Fhunker"


sourceControlJson : Int -> String
sourceControlJson behind =
    Encode.encode 0 <|
        Encode.object
            [ ( "status"
              , Encode.object
                    [ ( "path", Encode.string "/Users/mohamed/src/hunker" )
                    , ( "checkout"
                      , Encode.object
                            [ ( "_tag", Encode.string "TrackingBranch" )
                            , ( "name", Encode.string "main" )
                            , ( "oid", Encode.string "2222222222222222222222222222222222222222" )
                            , ( "upstream", Encode.string "origin/main" )
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
            , ( "diff"
              , Encode.string
                    """diff --git a/src/greet.ts b/src/greet.ts
index 1111111..2222222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1 +1 @@
-const greeting = "hi";
+const greeting = "hello";
"""
              )
            , ( "backing"
              , Encode.object
                    [ ( "source", Encode.string "github" )
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
