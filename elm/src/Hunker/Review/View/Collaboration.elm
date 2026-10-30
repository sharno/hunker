module Hunker.Review.View.Collaboration exposing
    ( Actions
    , detachedThreads
    , inlineComposer
    , lineThreads
    , reviewComposer
    )

import Html exposing (Html, article, button, div, form, h2, header, span, strong, text, textarea)
import Html.Attributes exposing (attribute, class, classList, disabled, id, placeholder, title, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import Hunker.ApiError as ApiError exposing (ApiError)
import Hunker.Domain.Review as Review exposing (CommentSide, ReviewAction(..), ReviewComment)
import Hunker.Review.Collaboration as Collaboration exposing (Inline(..), ReplyDraft(..), ReviewDraft(..), ReviewOutcome(..), Thread)
import Hunker.View.Time as TimeView
import Markdown


type alias Actions msg =
    { toggleThread : String -> Int -> msg
    , changeReply : String -> Int -> String -> msg
    , submitReply : String -> Int -> msg
    , changeInlineBody : String -> String -> msg
    , cancelInline : String -> msg
    , submitInline : String -> msg
    , changeReviewBody : String -> msg
    , submitReview : ReviewAction -> msg
    }


lineThreads : Actions msg -> Collaboration.FileState -> String -> CommentSide -> Int -> Html msg
lineThreads actions collaboration path side lineNumber =
    case Collaboration.threadsAt side lineNumber collaboration of
        [] ->
            text ""

        threads ->
            div [ class "inline-review-threads" ] (List.map (threadView actions collaboration path) threads)


detachedThreads : Actions msg -> Collaboration.FileState -> String -> Html msg
detachedThreads actions collaboration path =
    case Collaboration.detachedThreads collaboration of
        [] ->
            text ""

        threads ->
            div [ class "detached-review-threads" ] (List.map (threadView actions collaboration path) threads)


inlineComposer : Actions msg -> Collaboration.FileState -> String -> String -> Html msg
inlineComposer actions collaboration fileAnchor path =
    let
        composer anchor body sending error =
            form [ class "inline-comment-composer", onSubmit (actions.submitInline path) ]
                [ header [] [ strong [] [ text ("Comment on " ++ path ++ ":" ++ String.fromInt anchor.line) ], span [] [ text (Review.commentSideToString anchor.side) ] ]
                , textarea [ id ("inline-comment-" ++ fileAnchor), placeholder "Leave a review comment on GitHub…", value body, disabled sending, onInput (actions.changeInlineBody path) ] []
                , div []
                    [ button [ type_ "button", disabled sending, onClick (actions.cancelInline path) ] [ text "Cancel" ]
                    , button [ type_ "submit", disabled (sending || String.trim body == "") ]
                        [ text
                            (if sending then
                                "Adding…"

                             else
                                "Add comment"
                            )
                        ]
                    ]
                , apiErrorView error
                ]
    in
    case Collaboration.inline collaboration of
        InlineClosed ->
            text ""

        Composing anchor body error ->
            composer anchor body False error

        SubmittingInline _ anchor body ->
            composer anchor body True Nothing


reviewComposer : Actions msg -> Collaboration.Model -> Html msg
reviewComposer actions collaboration =
    let
        draft =
            Collaboration.reviewDraft collaboration

        ( body, submitting ) =
            case draft of
                DraftingReview text_ _ ->
                    ( text_, Nothing )

                SubmittingReview request text_ ->
                    ( text_, Just request )
    in
    form [ class "github-review-composer" ]
        [ h2 [] [ text "Submit review" ]
        , textarea [ placeholder "Leave an overall review…", value body, disabled (submitting /= Nothing), onInput actions.changeReviewBody ] []
        , div [] (List.map (reviewButton actions draft body) [ CommentReview, ApproveReview, RequestChangesReview ])
        , reviewFeedback draft
        ]


reviewButton : Actions msg -> ReviewDraft -> String -> ReviewAction -> Html msg
reviewButton actions draft body action =
    let
        ( label, submitting ) =
            case draft of
                SubmittingReview _ _ ->
                    ( actionLabel (submittingAction draft == Just action) action, True )

                DraftingReview _ _ ->
                    ( actionLabel False action, False )

        needsSummary =
            action /= ApproveReview && String.trim body == ""
    in
    button
        [ type_ "button"
        , disabled (submitting || needsSummary)
        , title
            (if needsSummary then
                "Write a review summary first"

             else
                label
            )
        , onClick (actions.submitReview action)
        ]
        [ text label ]


submittingAction : ReviewDraft -> Maybe ReviewAction
submittingAction draft =
    case draft of
        SubmittingReview request _ ->
            Just (Collaboration.reviewRequestAction request)

        DraftingReview _ _ ->
            Nothing


actionLabel : Bool -> ReviewAction -> String
actionLabel inFlight action =
    case ( inFlight, action ) of
        ( True, CommentReview ) ->
            "Commenting…"

        ( True, ApproveReview ) ->
            "Approving…"

        ( True, RequestChangesReview ) ->
            "Requesting changes…"

        ( False, CommentReview ) ->
            "Comment"

        ( False, ApproveReview ) ->
            "Approve"

        ( False, RequestChangesReview ) ->
            "Request changes"


reviewFeedback : ReviewDraft -> Html msg
reviewFeedback draft =
    case draft of
        DraftingReview _ Nothing ->
            text ""

        SubmittingReview _ _ ->
            div [ class "form-status", attribute "role" "status" ] [ text "Submitting review to GitHub…" ]

        DraftingReview _ (Just (ReviewAccepted action)) ->
            div [ class "form-success", attribute "role" "status" ] [ text (reviewSuccessMessage action) ]

        DraftingReview _ (Just (ReviewRejected error)) ->
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


threadView : Actions msg -> Collaboration.FileState -> String -> Thread -> Html msg
threadView actions collaboration path thread =
    let
        root =
            thread.root

        collapsed =
            Collaboration.isThreadCollapsed root.id collaboration
    in
    article [ classList [ ( "github-review-thread", True ), ( "is-resolved", root.resolved ) ] ]
        [ button [ type_ "button", class "review-thread-header", onClick (actions.toggleThread path root.id) ]
            [ span [] [ text (disclosure collapsed) ]
            , strong [] [ text root.author ]
            , if root.resolved then
                span [ class "resolved-tag" ] [ text "Resolved" ]

              else
                text ""
            , case root.anchor of
                Review.OutdatedLine side line ->
                    span [ class "resolved-tag" ] [ text ("Outdated · " ++ Review.commentSideToString side ++ " " ++ String.fromInt line) ]

                Review.OnLine _ _ ->
                    text ""

                Review.OnFile ->
                    text ""
            , span [] [ TimeView.view root.createdAt ]
            ]
        , if collapsed then
            text ""

          else
            div [ class "review-thread-body" ]
                (Markdown.toHtml [ class "github-markdown" ] root.body
                    :: List.map commentBody thread.replies
                    ++ [ replyComposer actions collaboration path root.id ]
                )
        ]


disclosure : Bool -> String
disclosure collapsed =
    if collapsed then
        "›"

    else
        "⌄"


commentBody : ReviewComment -> Html msg
commentBody comment =
    div [ class "github-review-reply" ]
        [ header [] [ strong [] [ text comment.author ], span [] [ TimeView.view comment.createdAt ] ]
        , Markdown.toHtml [ class "github-markdown" ] comment.body
        ]


replyComposer : Actions msg -> Collaboration.FileState -> String -> Int -> Html msg
replyComposer actions collaboration path threadId =
    let
        ( body, sending, error ) =
            case Collaboration.replyDraft threadId collaboration of
                EditingReply draft failure ->
                    ( draft, False, failure )

                SendingReply _ draft ->
                    ( draft, True, Nothing )
    in
    form [ class "review-reply-composer", onSubmit (actions.submitReply path threadId) ]
        [ textarea [ placeholder "Reply on GitHub…", value body, disabled sending, onInput (actions.changeReply path threadId) ] []
        , button [ type_ "submit", disabled (sending || String.trim body == "") ]
            [ text
                (if sending then
                    "Replying…"

                 else
                    "Reply"
                )
            ]
        , apiErrorView error
        ]


apiErrorView : Maybe ApiError -> Html msg
apiErrorView maybeError =
    case maybeError of
        Just error ->
            div [ class "form-error" ] [ text (ApiError.message error) ]

        Nothing ->
            text ""
