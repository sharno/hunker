module Hunker.Repository.View.Local exposing (CloneOffer, Unavailable(..), pageState, viewUnavailable)

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
    , loading : Bool
    , feedback : Maybe (Result ApiError String)
    , cloneTemporary : msg
    , cloneConfigured : msg
    }


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
                , cloneFeedback offer.feedback
                , div [ class "repository-clone-actions" ]
                    [ button [ type_ "button", disabled offer.loading, onClick offer.cloneTemporary ] [ text "Clone to /tmp" ]
                    , button [ type_ "button", disabled offer.loading, onClick offer.cloneConfigured ] [ text "Clone to repos root" ]
                    ]
                , small [] [ text "Clones start shallow and use your local GitHub authentication for private repositories." ]
                ]


cloneFeedback : Maybe (Result ApiError String) -> Html msg
cloneFeedback feedback =
    case feedback of
        Just (Ok message) ->
            p [ class "repository-clone-feedback" ] [ text message ]

        Just (Err error) ->
            p [ class "repository-clone-error" ] [ text (ApiError.message error) ]

        Nothing ->
            text ""


pageState : String -> String -> Html msg
pageState heading detail =
    section [ class "page-state" ] [ span [ class "loading-spinner" ] [], h1 [] [ text heading ], p [] [ text detail ] ]
