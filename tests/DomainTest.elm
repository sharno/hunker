module DomainTest exposing (suite)

import Dict
import Expect
import Hunker.Diff as Diff exposing (DiffLine(..), Kind(..))
import Hunker.Domain.Git as Git
import Hunker.Domain.Repository as Repository exposing (PullRequestState(..), SearchMode(..))
import Hunker.Domain.Review as Review exposing (MovedBlock)
import Hunker.Domain.Source as Source
import Hunker.FileTree as FileTree exposing (Tree(..))
import Hunker.Generated.ContractFixtures as ContractFixtures
import Hunker.Review.View.DiffPanel as DiffPanel
import Hunker.Route as Route exposing (PullView(..), RepositoryView(..), Route(..), Search(..))
import Hunker.SemanticMove as SemanticMove exposing (Endpoint(..))
import Json.Decode as Decode
import Set
import Test exposing (Test, describe, test)
import Time
import Url


suite : Test
suite =
    describe "Hunker Elm domain"
        [ describe "GitHub-shaped routes"
            [ test "round trips a selected PR file" <|
                \() ->
                    routeFrom "http://localhost:8787/oven-sh/bun/pull/36745/files/src/cli.ts"
                        |> Expect.equal
                            (Review
                                { repository = Git.repositoryId "oven-sh" "bun"
                                , subject = Route.PullRequest 36745 (PullFiles (Just "src/cli.ts"))
                                }
                            )
            , test "represents repository commits and branch paths without UI state" <|
                \() ->
                    Route.toPath (Repository { repository = Git.repositoryId "mohamed-rdr" "hunker", view = CommitsView (Just "feature/elm") })
                        |> Expect.equal "/mohamed-rdr/hunker/commits/feature/elm"
            , test "round trips a repository search with its mode" <|
                \() ->
                    let
                        route =
                            Repository
                                { repository = Git.repositoryId "mohamed-rdr" "hunker"
                                , view = FilesView { ref = Just "main", file = Nothing, search = Search "fn main" RegexSearch }
                                }
                    in
                    Expect.equal route (routeFrom ("http://localhost:8787" ++ Route.toPath route))
            , test "round trips a file line as GitHub's #L fragment" <|
                \() ->
                    let
                        route =
                            Repository
                                { repository = Git.repositoryId "acme" "demo"
                                , view = FilesView { ref = Just "main", file = Just { path = "src/a.rs", line = Just 42 }, search = Search "needle" LiteralSearch }
                                }
                    in
                    Expect.all
                        [ \_ -> Expect.equal "/acme/demo/blob/main/src/a.rs?q=needle#L42" (Route.toPath route)
                        , \_ -> Expect.equal route (routeFrom ("http://localhost:8787" ++ Route.toPath route))
                        , \_ -> Expect.equal (Ok route) (Route.fromGithubString "https://github.com/acme/demo/blob/main/src/a.rs?q=needle#L42-L50")
                        ]
                        ()
            , test "round trips a selected commit file through the canonical query" <|
                \() ->
                    let
                        route =
                            Review { repository = Git.repositoryId "mohamed-rdr" "hunker", subject = Route.Commit "6b0dfa8" (Just "elm/src/Hunker/Page/Review.elm") }

                        path =
                            Route.toPath route
                    in
                    Expect.all
                        [ \_ -> Expect.equal "/mohamed-rdr/hunker/commit/6b0dfa8?file=elm%2Fsrc%2FHunker%2FPage%2FReview.elm" path
                        , \_ -> Expect.equal route (routeFrom ("http://localhost:8787" ++ path))
                        ]
                        ()
            , test "keeps a selected file inside a pull request commit" <|
                \() ->
                    let
                        location =
                            Route.selectFile "src/a.rs"
                                { repository = Git.repositoryId "acme" "demo", subject = Route.PullRequest 7 (PullCommitFiles "abc1234" Nothing) }
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Route.PullRequest 7 (PullCommitFiles "abc1234" (Just "src/a.rs"))) location.subject
                        , \_ -> Expect.equal (Review location) (routeFrom ("http://localhost:8787" ++ Route.toPath (Review location)))
                        ]
                        ()
            , test "treats a file selection as the same screen and a tab switch as a new one" <|
                \() ->
                    let
                        pull view =
                            Review { repository = Git.repositoryId "acme" "demo", subject = Route.PullRequest 7 view }
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (Route.sameScreen (pull (PullFiles (Just "a.rs"))) (pull (PullFiles (Just "b.rs"))))
                        , \_ -> Expect.equal False (Route.sameScreen (pull (PullFiles (Just "a.rs"))) (pull PullCommits))
                        , \_ -> Expect.equal False (Route.sameScreen (pull (PullCommitFiles "abc1234" Nothing)) (pull (PullCommitFiles "def5678" Nothing)))
                        , \_ -> Expect.equal False (Route.sameScreen Home Route.Settings)
                        ]
                        ()
            , test "round trips a selected compare file through the canonical query" <|
                \() ->
                    let
                        route =
                            Review { repository = Git.repositoryId "mohamed-rdr" "hunker", subject = Route.Compare "main...feature/elm" (Just "server/src/main.rs") }
                    in
                    Expect.equal route (routeFrom ("http://localhost:8787" ++ Route.toPath route))
            , test "accepts only repository and review locations from pasted URLs" <|
                \() ->
                    Expect.all
                        [ \_ -> Expect.equal (Err Route.UnsupportedLocation) (Route.fromGithubString "https://github.com/settings")
                        , \_ -> Expect.equal (Err Route.ForeignHost) (Route.fromGithubString "https://gitlab.com/acme/demo")
                        , \_ -> Expect.equal (Err Route.UnparseableUrl) (Route.fromGithubString "not a url")
                        ]
                        ()
            ]
        , describe "diff parsing"
            [ test "aligns deletion and addition runs in split rows" <|
                \() ->
                    Diff.parsePatch "@@ -8,2 +8,2 @@\n-old name\n-old value\n+new name\n+new value"
                        |> List.concatMap (Diff.splitRows False)
                        |> List.map (\row -> ( Maybe.map .kind row.left, Maybe.map .kind row.right ))
                        |> Expect.equal
                            [ ( Just Deletion, Just Addition )
                            , ( Just Deletion, Just Addition )
                            ]
            , test "assigns immutable old and new line numbers" <|
                \() ->
                    Diff.parsePatch "@@ -3 +9 @@\n-old\n+new"
                        |> List.concatMap .lines
                        |> Expect.equal [ RemovedLine { old = 3, text = "old" }, AddedLine { new = 9, text = "new" } ]
            , test "does not render a trailing newline as a context line" <|
                \() ->
                    Diff.parsePatch "@@ -1 +1 @@\n-old\n+new\n"
                        |> List.concatMap .lines
                        |> List.length
                        |> Expect.equal 2
            , test "hides whitespace-only replacements in unified order too" <|
                \() ->
                    Diff.parsePatch "@@ -1,2 +1,2 @@\n-a  b\n-old\n+a b\n+new"
                        |> List.concatMap (Diff.splitRows True >> Diff.unifiedLines)
                        |> List.map Diff.lineText
                        |> Expect.equal [ "old", "new" ]
            , test "keeps multi-line change blocks in file order in unified view" <|
                \() ->
                    Diff.parsePatch "@@ -47,4 +47,4 @@\n ctx\n-old 48\n-old 49\n+new 48\n+new 49\n ctx"
                        |> List.concatMap (Diff.splitRows False >> Diff.unifiedLines)
                        |> List.map Diff.lineText
                        |> Expect.equal [ "ctx", "old 48", "old 49", "new 48", "new 49", "ctx" ]
            , test "anchors the footer comment on the last new-side line" <|
                \() ->
                    Expect.all
                        [ \_ -> Expect.equal (Just ( Diff.NewSide, 9 )) (Diff.lastAnchor (Diff.parsePatch "@@ -3 +9 @@\n-old\n+new"))
                        , \_ -> Expect.equal (Just ( Diff.OldSide, 4 )) (Diff.lastAnchor (Diff.parsePatch "@@ -3,2 +0,0 @@\n-gone\n-also gone"))
                        ]
                        ()
            , test "stitches zero-width insertion hunks into full-file context" <|
                \() ->
                    Diff.fullFileRows False
                        (Diff.parsePatch "@@ -2,0 +3 @@\n+inserted")
                        "alpha\nbeta\ntail"
                        "alpha\nbeta\ninserted\ntail"
                        |> List.map
                            (\row ->
                                ( Maybe.map (\line -> ( line.number, line.text, line.kind )) row.left
                                , Maybe.map (\line -> ( line.number, line.text, line.kind )) row.right
                                )
                            )
                        |> Expect.equal
                            [ ( Just ( 1, "alpha", Context ), Just ( 1, "alpha", Context ) )
                            , ( Just ( 2, "beta", Context ), Just ( 2, "beta", Context ) )
                            , ( Nothing, Just ( 3, "inserted", Addition ) )
                            , ( Just ( 3, "tail", Context ), Just ( 4, "tail", Context ) )
                            ]
            , test "renders ten thousand added lines without exhausting the stack" <|
                \() ->
                    ("@@ -0,0 +1,10000 @@\n" ++ String.join "\n" (List.repeat 10000 "+line"))
                        |> Diff.parsePatch
                        |> List.concatMap (Diff.splitRows False >> Diff.unifiedLines)
                        |> List.length
                        |> Expect.equal 10000
            ]
        , test "builds a directory-first nested file tree" <|
            \() ->
                FileTree.build .path
                    [ { path = "README.md" }
                    , { path = "src/view/app.ts" }
                    , { path = "src/index.ts" }
                    , { path = "docs/guide.md" }
                    ]
                    |> List.map treeName
                    |> Expect.equal [ "docs", "src", "README.md" ]
        , test "lists tree leaves in sidebar order" <|
            \() ->
                FileTree.build .path
                    [ { path = "README.md" }
                    , { path = "src/view/app.ts" }
                    , { path = "src/index.ts" }
                    , { path = "docs/guide.md" }
                    ]
                    |> FileTree.leaves
                    |> List.map .path
                    |> Expect.equal [ "docs/guide.md", "src/view/app.ts", "src/index.ts", "README.md" ]
        , test "gives every file path a distinct DOM anchor" <|
            \() ->
                List.map DiffPanel.fileAnchor [ "a_b.ts", "a-b.ts", "a/b.ts", "a.b.ts" ]
                    |> Set.fromList
                    |> Set.size
                    |> Expect.equal 4
        , test "gives both semantic move endpoints stable identities" <|
            \() ->
                Expect.all
                    [ \_ -> Expect.notEqual (SemanticMove.anchor semanticMove Source) (SemanticMove.anchor semanticMove Destination)
                    , \_ -> Expect.equal True (SemanticMove.tone semanticMove >= 0 && SemanticMove.tone semanticMove < 3)
                    ]
                    ()
        , test "decodes Rust source annotations and derives fold visibility" <|
            \() ->
                expectDecodes Source.decoder sourcePresentationFixture <|
                    \presentation ->
                        Expect.all
                            [ \_ ->
                                Source.highlightsAt 1 presentation
                                    |> List.map (.kind >> Source.highlightClass)
                                    |> Expect.equal [ "syntax-keyword", "syntax-function" ]
                            , \_ ->
                                Source.foldAt 1 presentation
                                    |> Maybe.map (Source.foldKey "new")
                                    |> Expect.equal (Just "new::function:1:3:greet")
                            , \_ -> Expect.equal True (Source.isLineHidden ((==) "new::function:1:3:greet") "new" 2 presentation)
                            , \_ -> Expect.equal False (Source.isLineHidden ((==) "new::function:1:3:greet") "new" 1 presentation)
                            ]
                            ()
        , describe "Rust-produced API contracts"
            [ test "decodes a typed review document with a renamed file" <|
                \() ->
                    expectDecodes Review.reviewDecoder ContractFixtures.reviewDocument <|
                        \document ->
                            Expect.all
                                [ \_ -> Expect.equal [ Review.FileModified, Review.FileRenamed "src/old.rs" ] (List.map .status document.files)
                                , \_ -> Expect.equal (String.repeat 40 "2") (Git.oidToString document.revision.headOid)
                                , \_ -> Expect.equal (Review.LocalSource "/Users/example/src/hunker") document.source
                                ]
                                ()
            , test "decodes a typed GitHub pull-request page" <|
                \() ->
                    expectDecodes Repository.pullRequestsDecoder ContractFixtures.repositoryPulls <|
                        \page ->
                            Expect.all
                                [ \_ -> Expect.equal OpenPulls page.state
                                , \_ -> Expect.equal [ Repository.DraftPull, Repository.MergedPull ] (List.map .status page.pullRequests)
                                , \_ -> Expect.equal [ Just "https://avatars.example/agent", Nothing ] (List.map .avatarUrl page.pullRequests)
                                ]
                                ()
            , test "decodes typed local source-control state" <|
                \() ->
                    expectDecodes Repository.sourceControlDecoder ContractFixtures.sourceControl <|
                        \status ->
                            case status.checkout of
                                Repository.TrackingBranch checkout ->
                                    Expect.all
                                        [ \_ -> Expect.equal "main" (Git.branchToString checkout.name)
                                        , \_ -> Expect.equal 2 checkout.behind
                                        , \_ -> Expect.equal [ Repository.LocalAndRemoteBranch, Repository.RemoteBranch ] (List.map .presence status.branches)
                                        , \_ -> Expect.equal (Repository.RemoteUnavailable 1786363200000 "Could not resolve host") status.remote
                                        ]
                                        ()

                                _ ->
                                    Expect.fail "Expected the Rust fixture to remain a tracking branch"
            , test "decodes typed GitHub review comments" <|
                \() ->
                    expectDecodes Review.commentsDecoder ContractFixtures.reviewComments <|
                        \comments ->
                            Expect.equal
                                [ ( 7, Review.OnLine Review.RightSide 12, True )
                                , ( 8, Review.OutdatedLine Review.LeftSide 3, False )
                                , ( 9, Review.OnFile, False )
                                ]
                                (List.map (\comment -> ( comment.id, comment.anchor, comment.resolved )) comments)
            , test "decodes a stale local revision" <|
                \() ->
                    expectDecodes Review.revisionDecoder ContractFixtures.revisionBehind <|
                        \revision ->
                            case revision of
                                Review.LocalRevision { head } ->
                                    case head of
                                        Review.HeadBehind latest ->
                                            Expect.equal (String.repeat 40 "3") (Git.oidToString latest)

                                        Review.HeadCurrent ->
                                            Expect.fail "Expected a newer head"

                                Review.GitHubRevision ->
                                    Expect.fail "Expected a local revision"
            , test "decodes pull request commits with optional author details" <|
                \() ->
                    expectDecodes Review.commitsDecoder ContractFixtures.pullCommits <|
                        \commits ->
                            Expect.equal [ ( Nothing, Just (Time.millisToPosix 1786363200000) ) ] (List.map (\commit -> ( commit.avatarUrl, commit.authoredAt )) commits)
            , test "decodes repository commit history" <|
                \() ->
                    expectDecodes Repository.commitsDecoder ContractFixtures.repositoryCommits <|
                        \commits ->
                            Expect.all
                                [ \_ -> Expect.equal Repository.ShallowHistory commits.history
                                , \_ -> Expect.equal [ "Keep history typed" ] (List.map .subject commits.commits)
                                ]
                                ()
            , test "decodes an analysis snapshot" <|
                \() ->
                    expectDecodes Review.analysisSnapshotDecoder ContractFixtures.analysisSnapshot <|
                        \snapshot ->
                            Expect.all
                                [ \_ -> Expect.equal [ "moved" ] (List.map .label snapshot.moves)
                                , \_ ->
                                    case Dict.get "src/main.rs" snapshot.files |> Maybe.map .wordDiff of
                                        Just (Review.FeatureComplete changes) ->
                                            Expect.equal [ 1 ] (List.map .line changes.old)

                                        _ ->
                                            Expect.fail "Expected a completed word diff"
                                ]
                                ()
            ]
        ]


expectDecodes : Decode.Decoder a -> String -> (a -> Expect.Expectation) -> Expect.Expectation
expectDecodes decoder json expectation =
    case Decode.decodeString decoder json of
        Ok value ->
            expectation value

        Err error ->
            Expect.fail (Decode.errorToString error)


routeFrom : String -> Route
routeFrom raw =
    raw
        |> Url.fromString
        |> Maybe.map Route.fromUrl
        |> Maybe.withDefault (NotFound raw)


treeName : Tree value -> String
treeName tree =
    case tree of
        Folder name _ _ ->
            name

        Leaf name _ ->
            name


semanticMove : MovedBlock
semanticMove =
    { fromPath = "src/old.ts"
    , toPath = "src/new.ts"
    , fromLine = 10
    , toLine = 30
    , fromLineCount = 4
    , toLineCount = 5
    , preview = "function calculate()"
    , kind = "function_declaration"
    , label = "calculate"
    }


sourcePresentationFixture : String
sourcePresentationFixture =
    """{"_tag":"Complete","value":{"language":"Rust","highlights":[{"line":1,"startCharacter":0,"endCharacter":2,"kind":"keyword"},{"line":1,"startCharacter":3,"endCharacter":8,"kind":"function"}],"folds":[{"id":"function:1:3:greet","kind":"function","label":"greet","startLine":1,"endLine":3}]}}"""
