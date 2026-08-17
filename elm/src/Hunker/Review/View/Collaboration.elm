module Hunker.Review.View.Collaboration exposing
    ( Actions
    , detachedThreads
    , inlineComposer
    , lineThreads
    , reviewComposer
    )

import Html exposing (Html, article, button, div, form, h2, header, span, strong, text, textarea)
import Html.Attributes exposing (class, disabled, id, placeholder, title, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import Hunker.ApiError as ApiError exposing (ApiError)
import Hunker.Domain.Review as Review exposing (CommentSide, ReviewAction(..), ReviewComment)
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
    , submitReview : ReviewAction -> msg
    }


lineThreads : Actions msg -> Collaboration.FileState -> String -> CommentSide -> Int -> Html msg
lineThreads actions collaboration path side lineNumber =
    case Collaboration.fileComments collaboration of
        Success _ values ->
            values
                |> rootComments
                |> List.filter (\comment -> comment.path == path && comment.side == side && comment.line == Just lineNumber)
                |> List.map (threadView actions collaboration values)
                |> div [ class "inline-review-threads" ]

        _ ->
            text ""


detachedThreads : Actions msg -> Collaboration.FileState -> String -> Html msg
detachedThreads actions collaboration path =
    case Collaboration.fileComments collaboration of
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


inlineComposer : Actions msg -> Collaboration.FileState -> String -> String -> Html msg
inlineComposer actions collaboration fileAnchor path =
    case Collaboration.inlineComposer collaboration of
        Just composer ->
            if composer.path /= path then
                text ""

            else
                let
                    loading =
                        Collaboration.inlineLoading collaboration
                in
                form [ class "inline-comment-composer", onSubmit actions.submitInline ]
                    [ header [] [ strong [] [ text ("Comment on " ++ path ++ ":" ++ String.fromInt composer.line) ], span [] [ text (Review.commentSideToString composer.side) ] ]
                    , textarea [ id ("inline-comment-" ++ fileAnchor), placeholder "Leave a review comment on GitHub…", value composer.body, disabled loading, onInput actions.changeInlineBody ] []
                    , div []
                        [ button [ type_ "button", disabled loading, onClick actions.cancelInline ] [ text "Cancel" ]
                        , button [ type_ "submit", disabled (loading || String.trim composer.body == "") ]
                            [ text
                                (if loading then
                                    "Adding…"

                                 else
                                    "Add comment"
                                )
                            ]
                        ]
                    , apiErrorView (Collaboration.inlineError collaboration)
                    ]

        Nothing ->
            text ""


reviewComposer : Actions msg -> Collaboration.Model -> Html msg
reviewComposer actions collaboration =
    let
        submission =
            Collaboration.reviewSubmissionState collaboration

        loading =
            case submission of
                Collaboration.ReviewSubmitting _ ->
                    True

                _ ->
                    False

        body =
            Collaboration.reviewBody collaboration
    in
    form [ class "github-review-composer" ]
        [ h2 [] [ text "Submit review" ]
        , textarea [ placeholder "Leave an overall review…", value body, disabled loading, onInput actions.changeReviewBody ] []
        , div []
            [ reviewButton actions submission body CommentReview
            , reviewButton actions submission body ApproveReview
            , reviewButton actions submission body RequestChangesReview
            ]
        , reviewFeedback submission
        ]


reviewButton : Actions msg -> Collaboration.ReviewSubmissionState -> String -> ReviewAction -> Html msg
reviewButton actions submission body action =
    let
        loading =
            case submission of
                Collaboration.ReviewSubmitting _ ->
                    True

                _ ->
                    False

        requiresBody =
            action /= ApproveReview

        label =
            case ( submission, action ) of
                ( Collaboration.ReviewSubmitting CommentReview, CommentReview ) ->
                    "Commenting…"

                ( Collaboration.ReviewSubmitting ApproveReview, ApproveReview ) ->
                    "Approving…"

                ( Collaboration.ReviewSubmitting RequestChangesReview, RequestChangesReview ) ->
                    "Requesting changes…"

                ( _, CommentReview ) ->
                    "Comment"

                ( _, ApproveReview ) ->
                    "Approve"

                ( _, RequestChangesReview ) ->
                    "Request changes"

        needsSummary =
            requiresBody && String.trim body == ""
    in
    button
        [ type_ "button"
        , disabled (loading || needsSummary)
        , title
            (if needsSummary then
                "Write a review summary first"

             else
                label
            )
        , onClick (actions.submitReview action)
        ]
        [ text label ]


reviewFeedback : Collaboration.ReviewSubmissionState -> Html msg
reviewFeedback submission =
    case submission of
        Collaboration.ReviewNotSubmitted ->
            text ""

        Collaboration.ReviewSubmitting _ ->
            div [ class "form-status", Html.Attributes.attribute "role" "status" ] [ text "Submitting review to GitHub…" ]

        Collaboration.ReviewSucceeded action ->
            div [ class "form-success", Html.Attributes.attribute "role" "status" ] [ text (reviewSuccessMessage action) ]

        Collaboration.ReviewSubmissionFailed error ->
            apiErrorView (Just error)


reviewSuccessMessage : ReviewAction -> String
reviewSuccessMessage action =
    case action of
        CommentReview ->
            "Review comment submitted to GitHub."

        ApproveReview ->
            "Review approved on GitHub."

        RequestChangesReview ->
            "Changes requested on GitHub."


rootComments : List ReviewComment -> List ReviewComment
rootComments =
    List.filter (\comment -> comment.id == comment.rootId)


threadView : Actions msg -> Collaboration.FileState -> List ReviewComment -> ReviewComment -> Html msg
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
            [ span []
                [ text
                    (if collapsed then
                        "›"

                     else
                        "⌄"
                    )
                ]
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


replyComposer : Actions msg -> Collaboration.FileState -> Int -> Html msg
replyComposer actions collaboration commentId =
    let
        loading =
            Collaboration.replyLoading commentId collaboration

        body =
            Collaboration.replyDraft commentId collaboration
    in
    form [ class "review-reply-composer", onSubmit (actions.submitReply commentId) ]
        [ textarea [ placeholder "Reply on GitHub…", value body, disabled loading, onInput (actions.changeReply commentId) ] []
        , button [ type_ "submit", disabled (loading || String.trim body == "") ]
            [ text
                (if loading then
                    "Replying…"

                 else
                    "Reply"
                )
            ]
        , apiErrorView (Collaboration.replyError commentId collaboration)
        ]


apiErrorView : Maybe ApiError -> Html msg
apiErrorView maybeError =
    case maybeError of
        Just error ->
            div [ class "form-error" ] [ text (ApiError.message error) ]

        Nothing ->
            text ""
