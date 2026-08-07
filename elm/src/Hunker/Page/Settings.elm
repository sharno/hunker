module Hunker.Page.Settings exposing (Model, Msg(..), SaveStatus(..), init, submission, update, view)

import Html exposing (Html, button, div, form, h1, header, input, label, main_, option, p, section, select, span, text)
import Html.Attributes exposing (checked, class, disabled, selected, type_, value)
import Html.Events exposing (onCheck, onInput, onSubmit)
import Hunker.Domain.Settings as Settings exposing (ReviewScope(..), Settings, ViewMode(..))
import Hunker.Effect as Effect exposing (Effect)


type alias Model =
    { draft : Settings }


type SaveStatus
    = SaveIdle
    | SaveInProgress
    | SaveSucceeded String
    | SaveError String


type Msg
    = ChangedRepositoriesRoot String
    | ChangedCacheRoot String
    | ChangedScope String
    | ChangedViewMode String
    | ChangedInlineMode String
    | ChangedIgnoreWhitespace Bool
    | ChangedSemantic Bool
    | ChangedSyntax Bool
    | ChangedSidebar Bool
    | ChangedReviews Bool
    | Submitted


init : Settings -> ( Model, Effect Msg )
init defaults =
    ( { draft = defaults }, Effect.none )


update : Msg -> Model -> ( Model, Effect Msg )
update msg model =
    case msg of
        ChangedRepositoriesRoot value ->
            draft (\settings -> { settings | repositoriesRoot = value }) model

        ChangedCacheRoot value ->
            draft (\settings -> { settings | cacheRoot = value }) model

        ChangedScope value ->
            draft
                (\settings ->
                    { settings
                        | reviewScope =
                            if value == "full" then
                                FullDiff

                            else
                                OneFile
                    }
                )
                model

        ChangedViewMode value ->
            draft
                (\settings ->
                    { settings
                        | viewMode =
                            if value == "unified" then
                                Unified

                            else
                                Split
                    }
                )
                model

        ChangedInlineMode value ->
            draft (\settings -> { settings | inlineDiffMode = Settings.inlineDiffModeFromString value }) model

        ChangedIgnoreWhitespace value ->
            draft (\settings -> { settings | ignoreWhitespace = value }) model

        ChangedSemantic value ->
            draft (\settings -> { settings | semantic = value }) model

        ChangedSyntax value ->
            draft (\settings -> { settings | syntaxHighlighting = value }) model

        ChangedSidebar value ->
            draft (\settings -> { settings | sidebarCollapsed = value }) model

        ChangedReviews value ->
            draft (\settings -> { settings | showGitHubReviews = value }) model

        Submitted ->
            ( model, Effect.none )


draft : (Settings -> Settings) -> Model -> ( Model, Effect Msg )
draft transform model =
    ( { model | draft = transform model.draft }, Effect.none )


submission : Msg -> Model -> Maybe Settings
submission msg model =
    case msg of
        Submitted ->
            Just model.draft

        _ ->
            Nothing


view : SaveStatus -> Model -> Html Msg
view saveStatus model =
    main_ [ class "settings-page" ]
        [ header [ class "settings-heading" ]
            [ span [ class "eyebrow" ] [ text "Local configuration" ]
            , h1 [] [ text "Hunker settings" ]
            , p [] [ text "These defaults live with the Rust server, so every browser and tab shares them." ]
            ]
        , settingsForm saveStatus model
        ]


settingsForm : SaveStatus -> Model -> Html Msg
settingsForm saveStatus model =
    form [ class "settings-form", onSubmit Submitted ]
        [ section [ class "settings-section" ]
            [ h1 [] [ text "Repository storage" ]
            , p [] [ text "Hunker discovers normal checkouts in the repos root and keeps disposable shallow clones in the cache root." ]
            , textField "Repositories root" model.draft.repositoriesRoot ChangedRepositoriesRoot
            , textField "Temporary clone root" model.draft.cacheRoot ChangedCacheRoot
            ]
        , section [ class "settings-section" ]
            [ h1 [] [ text "Review defaults" ]
            , selectField "Scope" (Settings.reviewScopeToString model.draft.reviewScope) ChangedScope [ ( "file", "One file" ), ( "full", "Full diff" ) ]
            , selectField "Layout" (Settings.viewModeToString model.draft.viewMode) ChangedViewMode [ ( "split", "Side by side" ), ( "unified", "Unified" ) ]
            , selectField "Inline diff" (Settings.inlineDiffModeToString model.draft.inlineDiffMode) ChangedInlineMode [ ( "token", "Word / token" ), ( "character", "Character" ), ( "off", "Off" ) ]
            , toggle "Ignore whitespace" "Hide whitespace-only replacements." model.draft.ignoreWhitespace ChangedIgnoreWhitespace
            , toggle "Semantic analysis" "Parse syntax trees and detect moved declarations." model.draft.semantic ChangedSemantic
            , toggle "Syntax highlighting" "Color supported source languages in repository and diff views." model.draft.syntaxHighlighting ChangedSyntax
            , toggle "Collapse review sidebar" "Start reviews with maximum horizontal space." model.draft.sidebarCollapsed ChangedSidebar
            , toggle "Show GitHub reviews" "Load and render inline review conversations." model.draft.showGitHubReviews ChangedReviews
            ]
        , div [ class "settings-actions" ]
            [ saveFeedback saveStatus
            , button [ type_ "submit", disabled (saveStatus == SaveInProgress) ]
                [ text
                    (if saveStatus == SaveInProgress then
                        "Saving…"

                     else
                        "Save settings"
                    )
                ]
            ]
        ]


textField : String -> String -> (String -> Msg) -> Html Msg
textField title current toMsg =
    label [ class "settings-field" ]
        [ span [] [ text title ]
        , input [ type_ "text", value current, onInput toMsg ] []
        ]


selectField : String -> String -> (String -> Msg) -> List ( String, String ) -> Html Msg
selectField title current toMsg choices =
    label [ class "settings-field" ]
        [ span [] [ text title ]
        , select [ onInput toMsg ]
            (List.map
                (\( encoded, description ) ->
                    option [ value encoded, selected (current == encoded) ] [ text description ]
                )
                choices
            )
        ]


toggle : String -> String -> Bool -> (Bool -> Msg) -> Html Msg
toggle title description current toMsg =
    label [ class "settings-toggle" ]
        [ input [ type_ "checkbox", checked current, onCheck toMsg ] []
        , span [] [ Html.strong [] [ text title ], Html.small [] [ text description ] ]
        ]


saveFeedback : SaveStatus -> Html Msg
saveFeedback saveStatus =
    case saveStatus of
        SaveSucceeded path ->
            span [ class "save-feedback is-success" ] [ text ("Saved to " ++ path) ]

        SaveError error ->
            span [ class "save-feedback is-error" ] [ text error ]

        _ ->
            text ""


state : String -> String -> Html Msg
state title detail =
    section [ class "page-state" ] [ span [ class "loading-spinner" ] [], h1 [] [ text title ], p [] [ text detail ] ]
