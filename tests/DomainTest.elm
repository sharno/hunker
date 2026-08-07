module DomainTest exposing (suite)

import Expect
import Hunker.Diff as Diff exposing (Kind(..))
import Hunker.Domain.Review as Review exposing (MovedBlock)
import Hunker.FileTree as FileTree exposing (Tree(..))
import Hunker.Route as Route exposing (RepositoryTab(..), ReviewTab(..), ReviewTarget(..), Route(..))
import Hunker.SemanticMove as SemanticMove exposing (Endpoint(..))
import Test exposing (Test, describe, test)
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
                                { target = PullRequest "oven-sh" "bun" 36745
                                , tab = ReviewFiles
                                , path = Just "src/cli.ts"
                                , commit = Nothing
                                }
                            )
            , test "represents repository commits and branch paths without UI state" <|
                \() ->
                    Route.toPath
                        (Repository
                            { owner = "mohamed-rdr"
                            , repository = "hunker"
                            , tab = RepositoryCommits
                            , ref = Just "feature/elm"
                            , path = Nothing
                            , query = ""
                            , searchMode = "literal"
                            , pullState = "open"
                            }
                        )
                        |> Expect.equal "/mohamed-rdr/hunker/commits/feature/elm"
            , test "round trips a selected commit file through the canonical query" <|
                \() ->
                    let
                        route =
                            Review
                                { target = Commit "mohamed-rdr" "hunker" "6b0dfa8"
                                , tab = ReviewFiles
                                , path = Just "elm/src/Hunker/Page/Review.elm"
                                , commit = Nothing
                                }

                        path =
                            Route.toPath route
                    in
                    Expect.all
                        [ \_ -> Expect.equal "/mohamed-rdr/hunker/commit/6b0dfa8?file=elm%2Fsrc%2FHunker%2FPage%2FReview.elm" path
                        , \_ -> Expect.equal route (routeFrom ("http://localhost:8787" ++ path))
                        ]
                        ()
            , test "round trips a selected compare file through the canonical query" <|
                \() ->
                    let
                        route =
                            Review
                                { target = Compare "mohamed-rdr" "hunker" "main...feature/elm"
                                , tab = ReviewFiles
                                , path = Just "server/src/main.rs"
                                , commit = Nothing
                                }
                    in
                    Route.toPath route
                        |> (\path -> routeFrom ("http://localhost:8787" ++ path))
                        |> Expect.equal route
            ]
        , describe "diff parsing"
            [ test "aligns deletion and addition runs in split rows" <|
                \() ->
                    Diff.parsePatch "@@ -8,2 +8,2 @@\n-old name\n-old value\n+new name\n+new value"
                        |> List.head
                        |> Maybe.map (Diff.splitRows False)
                        |> Maybe.map
                            (List.map
                                (\row ->
                                    ( Maybe.map .kind row.left
                                    , Maybe.map .kind row.right
                                    )
                                )
                            )
                        |> Expect.equal
                            (Just
                                [ ( Just Deletion, Just Addition )
                                , ( Just Deletion, Just Addition )
                                ]
                            )
            , test "assigns immutable old and new line numbers" <|
                \() ->
                    Diff.parsePatch "@@ -3 +9 @@\n-old\n+new"
                        |> List.head
                        |> Maybe.map .lines
                        |> Maybe.map (List.map (\line -> ( line.oldLine, line.newLine )))
                        |> Expect.equal (Just [ ( Just 3, Nothing ), ( Nothing, Just 9 ) ])
            , test "stitches zero-width insertion hunks into full-file context" <|
                \() ->
                    Diff.fullFileRows
                        "@@ -2,0 +3 @@\n+inserted"
                        "alpha\nbeta\ntail"
                        "alpha\nbeta\ninserted\ntail"
                        |> List.map
                            (\row ->
                                ( Maybe.map (\line -> ( line.number, line.text, line.kind )) row.left
                                , Maybe.map (\line -> ( line.number, line.text, line.kind )) row.right
                                )
                            )
                        |> Expect.equal
                            [ ( Just ( Just 1, "alpha", Context ), Just ( Just 1, "alpha", Context ) )
                            , ( Just ( Just 2, "beta", Context ), Just ( Just 2, "beta", Context ) )
                            , ( Nothing, Just ( Just 3, "inserted", Addition ) )
                            , ( Just ( Just 3, "tail", Context ), Just ( Just 4, "tail", Context ) )
                            ]
            , test "does not split a diff header embedded in changed source" <|
                \() ->
                    Review.fileChangesFromDiff "diff --git a/test.ts b/test.ts\n--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-const fixture = `diff --git a/a b/a`;\n+const fixture = `new file mode`;"
                        |> List.map (\file -> ( file.path, file.status ))
                        |> Expect.equal [ ( "test.ts", "modified" ) ]
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
        , test "gives both semantic move endpoints stable identities and coverage" <|
            \() ->
                let
                    move =
                        semanticMove
                in
                Expect.all
                    [ \_ -> Expect.notEqual (SemanticMove.anchor move Source) (SemanticMove.anchor move Destination)
                    , \_ -> Expect.equal True (SemanticMove.containsLine "src/old.ts" 12 Source move)
                    , \_ -> Expect.equal True (SemanticMove.containsLine "src/new.ts" 34 Destination move)
                    , \_ -> Expect.equal True (SemanticMove.tone move >= 0 && SemanticMove.tone move < 3)
                    ]
                    ()
        ]


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
    , confidence = 0.8
    , changed = True
    }
