module ReviewSessionTest exposing (suite)

import Dict
import Expect exposing (Expectation)
import Hunker.Domain.Git as Git
import Hunker.Domain.Review exposing (CommentSide(..), FileChange, FileStatus(..), ReviewAction(..), ReviewComment)
import Hunker.Domain.Settings exposing (Feature(..), InlineDiffMode(..), Whitespace(..))
import Hunker.Domain.Source as Source
import Hunker.Remote exposing (Remote(..))
import Hunker.Review.Analysis as Analysis
import Hunker.Review.Collaboration as Collaboration exposing (Inline(..), ReplyDraft(..))
import Hunker.Review.DiffView as DiffView
import Hunker.Review.FileIndex as FileIndex
import Hunker.Review.Session as Session
import Hunker.Route as Route
import Hunker.SemanticMove exposing (Endpoint(..))
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "review session isolation"
        [ test "an old reply cannot mutate the next review" <|
            \() ->
                withSessions <|
                    \firstSession secondSession ->
                        let
                            first =
                                loadedCollaboration firstSession [ firstComment ]
                                    |> Collaboration.changeReply "src/first.elm" 11 "reply from the first review"

                            second =
                                loadedCollaboration secondSession [ secondComment ]
                        in
                        expectJust "a reply submission" (Collaboration.beginReply "src/first.elm" 11 first) <|
                            \( _, submission ) ->
                                Collaboration.replyLoaded submission.request (reply 99 11 "src/first.elm") second
                                    |> Expect.equal second
        , test "replying on one thread keeps another thread's reply in flight" <|
            \() ->
                withSessions <|
                    \firstSession secondSession ->
                        let
                            loaded =
                                loadedCollaboration firstSession [ firstComment, comment 12 "src/first.elm" ]
                                    |> Collaboration.changeReply "src/first.elm" 11 "first"
                                    |> Collaboration.changeReply "src/first.elm" 12 "second"
                        in
                        expectJust "the first reply" (Collaboration.beginReply "src/first.elm" 11 loaded) <|
                            \( sending, firstSubmission ) ->
                                expectJust "the second reply" (Collaboration.beginReply "src/first.elm" 12 sending) <|
                                    \( bothSending, _ ) ->
                                        let
                                            settled =
                                                Collaboration.replyLoaded firstSubmission.request (reply 99 11 "src/first.elm") bothSending
                                        in
                                        Expect.all
                                            [ \_ -> Expect.equal (EditingReply "" Nothing) (Collaboration.replyDraft 11 (Collaboration.fileState "src/first.elm" settled))
                                            , \_ ->
                                                case Collaboration.replyDraft 12 (Collaboration.fileState "src/first.elm" settled) of
                                                    SendingReply _ body ->
                                                        Expect.equal "second" body

                                                    EditingReply _ _ ->
                                                        Expect.fail "the second reply lost its in-flight state"
                                            , \_ ->
                                                Collaboration.threadsAt RightSide 1 (Collaboration.fileState "src/first.elm" settled)
                                                    |> List.concatMap .replies
                                                    |> List.map .id
                                                    |> Expect.equal [ 99 ]
                                            ]
                                            ()
        , test "a review in flight cannot be submitted twice" <|
            \() ->
                withSessions <|
                    \firstSession secondSession ->
                        let
                            drafted =
                                Collaboration.init firstSession firstPull
                                    |> Collaboration.changeReviewBody "Looks good"
                        in
                        expectJust "a review submission" (Collaboration.beginReview ApproveReview drafted) <|
                            \( submitting, _ ) ->
                                Collaboration.beginReview CommentReview submitting
                                    |> Expect.equal Nothing
        , test "only approvals may submit without a summary" <|
            \() ->
                withSessions <|
                    \firstSession secondSession ->
                        let
                            empty =
                                Collaboration.init firstSession firstPull
                        in
                        Expect.all
                            [ \_ -> Expect.equal Nothing (Collaboration.beginReview CommentReview empty)
                            , \_ -> Expect.notEqual Nothing (Collaboration.beginReview ApproveReview empty)
                            ]
                            ()
        , test "an old inline comment cannot close the next review's composer" <|
            \() ->
                withSessions <|
                    \firstSession secondSession ->
                        let
                            first =
                                Collaboration.init firstSession firstPull
                                    |> Collaboration.openInline { path = "src/first.elm", line = 10, side = RightSide }
                                    |> Collaboration.changeInlineBody "src/first.elm" "comment from the first review"

                            second =
                                Collaboration.init secondSession secondPull
                                    |> Collaboration.openInline { path = "src/first.elm", line = 20, side = RightSide }
                        in
                        expectJust "an inline submission" (Collaboration.submitInline "src/first.elm" first) <|
                            \( _, submission ) ->
                                Collaboration.inlineLoaded submission.request firstComment second
                                    |> Collaboration.fileState "src/first.elm"
                                    |> Collaboration.inline
                                    |> Expect.equal (Composing { path = "src/first.elm", line = 20, side = RightSide } "" Nothing)
        , test "an inline comment in flight cannot be replaced by another composer" <|
            \() ->
                withSessions <|
                    \firstSession secondSession ->
                        let
                            composing =
                                Collaboration.init firstSession firstPull
                                    |> Collaboration.openInline { path = "src/first.elm", line = 10, side = RightSide }
                                    |> Collaboration.changeInlineBody "src/first.elm" "keep me"
                        in
                        expectJust "an inline submission" (Collaboration.submitInline "src/first.elm" composing) <|
                            \( submitting, _ ) ->
                                submitting
                                    |> Collaboration.openInline { path = "src/second.elm", line = 3, side = LeftSide }
                                    |> Collaboration.fileState "src/second.elm"
                                    |> Collaboration.inline
                                    |> Expect.equal InlineClosed
        , test "an old full-file response cannot populate the next review" <|
            \() ->
                withSessions <|
                    \firstSession secondSession ->
                        expectJust "a full-file request" (DiffView.init firstSession |> DiffView.toggleFullFile "src/shared.elm" |> Tuple.second) <|
                            \request ->
                                DiffView.init secondSession
                                    |> DiffView.fileLoaded request
                                        { oldText = "old"
                                        , newText = "new"
                                        , presentation = Source.filePresentation Source.unsupported Source.unsupported
                                        }
                                    |> DiffView.fileState "src/shared.elm"
                                    |> DiffView.fileFullFile
                                    |> Expect.equal NotAsked
        , test "an old analysis cannot separate a snapshot from its prepared files" <|
            \() ->
                withSessions <|
                    \firstSession secondSession ->
                        let
                            ( _, stale ) =
                                Analysis.begin secondSession analysisOptions (Analysis.init (FileIndex.fromChanges [ changedFile ]))

                            ( inFlight, _ ) =
                                Analysis.begin firstSession analysisOptions (Analysis.init (FileIndex.fromChanges [ changedFile ]))
                        in
                        expectJust "a stale analysis identity" stale <|
                            \staleIdentity ->
                                let
                                    state =
                                        Analysis.complete staleIdentity { files = Dict.empty, moves = [] } inFlight
                                in
                                Expect.all
                                    [ \_ -> Expect.equal Analysis.AnalysisInFlight (Analysis.status state)
                                    , \_ -> Expect.equal [ "src/shared.elm" ] (Analysis.files state |> FileIndex.changes |> List.map .path)
                                    ]
                                    ()
        , test "a file UI transition preserves unrelated file state" <|
            \() ->
                withSessions <|
                    \firstSession secondSession ->
                        let
                            initial =
                                DiffView.init firstSession

                            updated =
                                DiffView.toggleHunk "src/first.elm" "hunk-1" initial
                        in
                        Expect.equal (DiffView.fileState "src/second.elm" initial) (DiffView.fileState "src/second.elm" updated)
        , test "a reply draft preserves unrelated file collaboration" <|
            \() ->
                withSessions <|
                    \firstSession secondSession ->
                        let
                            initial =
                                loadedCollaboration firstSession [ firstComment, secondComment ]

                            updated =
                                Collaboration.changeReply "src/first.elm" firstComment.id "only the first file" initial
                        in
                        Expect.equal (Collaboration.fileState "src/second.elm" initial) (Collaboration.fileState "src/second.elm" updated)
        , test "semantic moves are indexed by file endpoint and line" <|
            \() ->
                withSessions <|
                    \firstSession secondSession ->
                        let
                            move =
                                { fromPath = "src/first.elm"
                                , toPath = "src/second.elm"
                                , fromLine = 4
                                , toLine = 20
                                , fromLineCount = 3
                                , toLineCount = 2
                                , preview = "view model"
                                , kind = "function_declaration"
                                , label = "view"
                                }

                            analyzed =
                                FileIndex.fromChanges [ { changedFile | path = "src/first.elm" }, { changedFile | path = "src/second.elm" } ]
                                    |> FileIndex.withAnalysis { files = Dict.empty, moves = [ move ] }

                            labelAt path endpoint line =
                                FileIndex.get path analyzed
                                    |> Maybe.andThen (FileIndex.moveAt endpoint line)
                                    |> Maybe.map .label
                        in
                        Expect.all
                            [ \_ -> Expect.equal (Just "view") (labelAt "src/first.elm" Source 6)
                            , \_ -> Expect.equal (Just "view") (labelAt "src/second.elm" Destination 21)
                            , \_ -> Expect.equal Nothing (labelAt "src/first.elm" Source 7)
                            ]
                            ()
        ]


expectJust : String -> Maybe a -> (a -> Expectation) -> Expectation
expectJust description maybe expectation =
    case maybe of
        Just value ->
            expectation value

        Nothing ->
            Expect.fail ("expected " ++ description)


loadedCollaboration : Session.Id -> List ReviewComment -> Collaboration.Model
loadedCollaboration session comments =
    case Collaboration.beginComments (Collaboration.init session firstPull) of
        Just ( loading, requested ) ->
            Collaboration.commentsLoaded requested comments loading

        Nothing ->
            Collaboration.init session firstPull


analysisOptions : { whitespace : Whitespace, semantic : Feature, syntax : Feature, inlineDiff : InlineDiffMode }
analysisOptions =
    { whitespace = IgnoreWhitespace, semantic = Enabled, syntax = Enabled, inlineDiff = Token }


{-| Runs a test with two sessions on different pull requests and heads.
-}
withSessions : (Session.Id -> Session.Id -> Expectation) -> Expectation
withSessions test =
    case ( Git.oidFromString (String.repeat 40 "1"), Git.oidFromString (String.repeat 40 "2") ) of
        ( Just firstHead, Just secondHead ) ->
            test (Session.create (Route.pullRequestUrl firstPull) firstHead) (Session.create (Route.pullRequestUrl secondPull) secondHead)

        _ ->
            Expect.fail "fixture OIDs should be valid"


firstPull : Route.PullRequestRef
firstPull =
    { repository = Git.repositoryId "example" "one", number = 1 }


secondPull : Route.PullRequestRef
secondPull =
    { repository = Git.repositoryId "example" "two", number = 2 }


firstComment : ReviewComment
firstComment =
    comment 11 "src/first.elm"


secondComment : ReviewComment
secondComment =
    comment 22 "src/second.elm"


comment : Int -> String -> ReviewComment
comment id path =
    reply id id path


reply : Int -> Int -> String -> ReviewComment
reply id rootId path =
    { id = id
    , rootId = rootId
    , path = path
    , body = "comment"
    , author = "reviewer"
    , htmlUrl = ""
    , createdAt = ""
    , line = Just 1
    , side = RightSide
    , resolved = False
    }


changedFile : FileChange
changedFile =
    { path = "src/shared.elm"
    , status = FileModified
    , additions = 1
    , deletions = 1
    , patch = "@@ -1 +1 @@\n-old\n+new"
    }
