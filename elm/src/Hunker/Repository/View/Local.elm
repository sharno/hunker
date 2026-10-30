module Hunker.Repository.View.Local exposing (Clone(..), CloneOffer, Unavailable(..), errorState, pageState, viewUnavailable)

import Html exposing (Html, button, div, h1, p, section, small, span, text)
import Html.Attributes exposing (class, disabled, type_)
import Html.Events exposing (onClick)
import Hunker.ApiError as ApiError exposing (ApiError)


type Unavailable msg
    = Resolving String String
    | Missing (CloneOffer msg)
    | Failed String ApiError


type alias CloneOffer msg =
    { error : ApiError
    , clone : Clone
    , cloneTemporary : msg
    , cloneConfigured : msg
    }


type Clone
    = NotCloning
    | Cloning
    | CloneFailed ApiError


viewUnavailable : Unavailable msg -> Html msg
viewUnavailable unavailable =
    case unavailable of
        Resolving heading detail ->
            pageState heading detail

        Failed heading error ->
            pageState heading (ApiError.message error)

        Missing offer ->
            section [ class "repository-clone-offer" ]
                [ span [ class "repository-clone-mark" ] [ text "git" ]
                , h1 [] [ text "Clone this repository for local browsing" ]
                , p [] [ text (ApiError.message offer.error) ]
                , cloneFeedback offer.clone
                , div [ class "repository-clone-actions" ]
                    [ button [ type_ "button", disabled (offer.clone == Cloning), onClick offer.cloneTemporary ] [ text "Clone to /tmp" ]
                    , button [ type_ "button", disabled (offer.clone == Cloning), onClick offer.cloneConfigured ] [ text "Clone to repos root" ]
                    ]
                , small [] [ text "Clones start shallow and use your local GitHub authentication for private repositories." ]
                ]


cloneFeedback : Clone -> Html msg
cloneFeedback clone =
    case clone of
        Cloning ->
            p [ class "repository-clone-feedback", Html.Attributes.attribute "role" "status" ] [ text "Cloning…" ]

        CloneFailed error ->
            p [ class "repository-clone-error", Html.Attributes.attribute "role" "alert" ] [ text (ApiError.message error) ]

        NotCloning ->
            text ""


errorState : String -> ApiError -> Html msg
errorState heading error =
    section [ class "page-state is-error" ] [ h1 [] [ text heading ], p [] [ text (ApiError.message error) ] ]


pageState : String -> String -> Html msg
pageState heading detail =
    section [ class "page-state" ] [ span [ class "loading-spinner" ] [], h1 [] [ text heading ], p [] [ text detail ] ]
