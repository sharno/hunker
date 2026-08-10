module Hunker.Review.View.Collaboration exposing
    ( Actions
    , detachedThreads
    , inlineComposer
    , lineThreads
    , reviewComposer
    )

import Html exposing (Html, article, button, div, form, h2, header, span, strong, text, textarea)
import Html.Attributes exposing (class, disabled, id, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import Hunker.ApiError as ApiError exposing (ApiError)
import Hunker.Domain.Review as Review exposing (CommentSide, ReviewComment)
import Hunker.Remote exposing (Remote(..))
import Hunker.Review.Collaboration as Collaboration
import Markdown


type alias Actions msg =
    { toggleThread : Int -> msg
    , changeReply : Int -> String -> msg
    , submitReply : Int -> msg
    , changeInlineBody : String -> msg
    , cancelInline : msg
    , submitInline : msg
    , changeReviewBody : String -> msg
    , submitReview : String -> msg
    }


lineThreads : Actions msg -> Collaboration.Model -> Remote request ApiError (List ReviewComment) -> String -> CommentSide -> Int -> Html msg
lineThreads actions collaboration comments path side lineNumber =
    case comments of
        Success _ values ->
            values
                |> rootComments
                |> List.filter (\comment -> comment.path == path && comment.side == side && comment.line == Just lineNumber)
                |> List.map (threadView actions collaboration values)
                |> div [ class "inline-review-threads" ]

        _ ->
            text ""


detachedThreads : Actions msg -> Collaboration.Model -> Remote request ApiError (List ReviewComment) -> String -> Html msg
detachedThreads actions collaboration comments path =
    case comments of
        Success _ values ->
            values
                |> rootComments
                |> List.filter (\comment -> comment.path == path && comment.line == Nothing)
                |> List.map (threadView actions collaboration values)
                |> div [ class "detached-review-threads" ]

        Failure _ error ->
            div [ class "review-comments-error" ] [ text (ApiError.message error) ]

        _ ->
            text ""


inlineComposer : Actions msg -> Collaboration.Model -> String -> String -> Html msg
inlineComposer actions collaboration fileAnchor path =
    case Collaboration.inlineComposer collaboration of
        Just composer ->
            if composer.path /= path then
                text ""

            else
                form [ class "inline-comment-composer", onSubmit actions.submitInline ]
                    [ header [] [ strong [] [ text ("Comment on " ++ path ++ ":" ++ String.fromInt composer.line) ], span [] [ text (Review.commentSideToString composer.side) ] ]
                    , textarea [ id ("inline-comment-" ++ fileAnchor), placeholder "Leave a review comment on GitHub…", value composer.body, onInput actions.changeInlineBody ] []
                    , div []
                        [ button [ type_ "button", onClick actions.cancelInline ] [ text "Cancel" ]
                        , button [ type_ "submit", disabled (Collaboration.inlineLoading collaboration) ] [ text "Add comment" ]
                        ]
                    , apiErrorView (Collaboration.inlineError collaboration)
                    ]

        Nothing ->
            text ""


reviewComposer : Actions msg -> Collaboration.Model -> Html msg
reviewComposer actions collaboration =
    form [ class "github-review-composer" ]
        [ h2 [] [ text "Submit review" ]
        , textarea [ placeholder "Leave an overall review…", value (Collaboration.reviewBody collaboration), onInput actions.changeReviewBody ] []
        , div []
            [ button [ type_ "button", onClick (actions.submitReview "COMMENT") ] [ text "Comment" ]
            , button [ type_ "button", onClick (actions.submitReview "APPROVE") ] [ text "Approve" ]
            , button [ type_ "button", onClick (actions.submitReview "REQUEST_CHANGES") ] [ text "Request changes" ]
            ]
        , apiErrorView (Collaboration.reviewError collaboration)
        ]


rootComments : List ReviewComment -> List ReviewComment
rootComments =
    List.filter (\comment -> comment.id == comment.rootId)


threadView : Actions msg -> Collaboration.Model -> List ReviewComment -> ReviewComment -> Html msg
threadView actions collaboration comments root =
    let
        collapsed =
            Collaboration.isThreadCollapsed root.rootId collaboration

        replies =
            List.filter (\comment -> comment.rootId == root.rootId && comment.id /= root.id) comments
    in
    article
        [ class
            ("github-review-thread"
                ++ (if root.resolved then
                        " is-resolved"

                    else
                        ""
                   )
            )
        ]
        [ button [ type_ "button", class "review-thread-header", onClick (actions.toggleThread root.rootId) ]
            [ span [] [ text (if collapsed then "›" else "⌄") ]
            , strong [] [ text root.author ]
            , if root.resolved then
                span [ class "resolved-tag" ] [ text "Resolved" ]

              else
                text ""
            , span [] [ text root.createdAt ]
            ]
        , if collapsed then
            text ""

          else
            div [ class "review-thread-body" ]
                (Markdown.toHtml [ class "github-markdown" ] root.body
                    :: List.map commentBody replies
                    ++ [ replyComposer actions collaboration root.rootId ]
                )
        ]


commentBody : ReviewComment -> Html msg
commentBody comment =
    div [ class "github-review-reply" ]
        [ header [] [ strong [] [ text comment.author ], span [] [ text comment.createdAt ] ]
        , Markdown.toHtml [ class "github-markdown" ] comment.body
        ]


replyComposer : Actions msg -> Collaboration.Model -> Int -> Html msg
replyComposer actions collaboration commentId =
    form [ class "review-reply-composer", onSubmit (actions.submitReply commentId) ]
        [ textarea [ placeholder "Reply on GitHub…", value (Collaboration.replyDraft commentId collaboration), onInput (actions.changeReply commentId) ] []
        , button [ type_ "submit", disabled (Collaboration.replyLoading commentId collaboration) ] [ text "Reply" ]
        , apiErrorView (Collaboration.replyError commentId collaboration)
        ]


apiErrorView : Maybe ApiError -> Html msg
apiErrorView maybeError =
    case maybeError of
        Just error ->
            div [ class "form-error" ] [ text (ApiError.message error) ]

        Nothing ->
            text ""
