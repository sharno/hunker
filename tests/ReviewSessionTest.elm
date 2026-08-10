module ReviewSessionTest exposing (suite)

import Expect
import Hunker.Domain.Review exposing (CommentSide(..), ReviewComment)
import Hunker.Remote exposing (Remote(..))
import Hunker.Review.Collaboration as Collaboration
import Hunker.Review.DiffView as DiffView
import Hunker.Review.Session as Session
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "review session isolation"
        [ test "an old reply cannot mutate the next review" <|
            \() ->
                let
                    first =
                        Collaboration.init firstSession False
                            |> Collaboration.changeReply 7 "reply from the first review"

                    request =
                        Collaboration.beginReply 7 first
                            |> Tuple.second
                            |> Maybe.map .request

                    second =
                        Collaboration.init secondSession False
                            |> Collaboration.commentsLoaded secondSession [ secondComment ]

                    afterOldResponse =
                        request
                            |> Maybe.map (\value -> Collaboration.replyLoaded value firstComment second)
                            |> Maybe.withDefault second
                in
                Expect.equal [ 22 ] (commentIds afterOldResponse)
        , test "an old inline comment cannot close the next review's composer" <|
            \() ->
                let
                    first =
                        Collaboration.init firstSession False
                            |> Collaboration.openInline "src/first.elm" 10 RightSide
                            |> Collaboration.changeInlineBody "comment from the first review"

                    request =
                        Collaboration.submitInline first
                            |> Tuple.second
                            |> Maybe.map .request

                    second =
                        Collaboration.init secondSession False
                            |> Collaboration.openInline "src/second.elm" 20 RightSide

                    afterOldResponse =
                        request
                            |> Maybe.map (\value -> Collaboration.inlineLoaded value firstComment second)
                            |> Maybe.withDefault second
                in
                afterOldResponse
                    |> Collaboration.inlineComposer
                    |> Maybe.map .path
                    |> Expect.equal (Just "src/second.elm")
        , test "an old full-file response cannot populate the next review" <|
            \() ->
                let
                    request =
                        DiffView.init firstSession
                            |> DiffView.toggleFullFile "src/shared.elm"
                            |> Tuple.second

                    second =
                        DiffView.init secondSession

                    afterOldResponse =
                        request
                            |> Maybe.map
                                (\value ->
                                    DiffView.fileLoaded value
                                        { oldText = "old"
                                        , newText = "new"
                                        }
                                        second
                                )
                            |> Maybe.withDefault second
                in
                Expect.equal Nothing (DiffView.fullFile "src/shared.elm" afterOldResponse)
        ]


commentIds : Collaboration.Model -> List Int
commentIds model =
    case Collaboration.comments model of
        Success _ comments ->
            List.map .id comments

        _ ->
            []


firstSession : Session.Id
firstSession =
    Session.create "https://github.com/example/one/pull/1" "https://github.com/example/one/pull/1" "1111111"


secondSession : Session.Id
secondSession =
    Session.create "https://github.com/example/two/pull/2" "https://github.com/example/two/pull/2" "2222222"


firstComment : ReviewComment
firstComment =
    comment 11 "src/first.elm"


secondComment : ReviewComment
secondComment =
    comment 22 "src/second.elm"


comment : Int -> String -> ReviewComment
comment id path =
    { id = id
    , rootId = id
    , path = path
    , body = "comment"
    , author = "reviewer"
    , htmlUrl = ""
    , createdAt = ""
    , line = Just 1
    , side = RightSide
    , resolved = False
    }
