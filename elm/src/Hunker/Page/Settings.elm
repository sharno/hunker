module Hunker.Page.Settings exposing (Model, Msg(..), init, update, view)

import Html exposing (Html, button, div, form, h1, header, input, label, main_, option, p, section, select, span, text)
import Html.Attributes exposing (checked, class, disabled, selected, type_, value)
import Html.Events exposing (onCheck, onInput, onSubmit)
import Hunker.Api as Api
import Hunker.Domain.Settings as Settings exposing (InlineDiffMode(..), ReviewScope(..), Settings, SettingsDocument, ViewMode(..))
import Hunker.Effect as Effect exposing (Effect)
import Hunker.Remote exposing (Remote(..))


type alias Model =
    { load : Remote () String SettingsDocument
    , draft : Settings
    , save : Remote Int String SettingsDocument
    , generation : Int
    }


type Msg
    = Loaded SettingsDocument
    | LoadFailed String
    | ChangedRepositoriesRoot String
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
    | Saved Int SettingsDocument
    | SaveFailed Int String


init : Settings -> ( Model, Effect Msg )
init defaults =
    ( { load = Loading ()
      , draft = defaults
      , save = NotAsked
      , generation = 0
      }
    , Api.loadSettings Loaded LoadFailed
    )


update : Msg -> Model -> ( Model, Effect Msg )
update msg model =
    case msg of
        Loaded document ->
            ( { model | load = Success () document, draft = document.settings }, Effect.none )

        LoadFailed error ->
            ( { model | load = Failure () error }, Effect.none )

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
            let
                generation =
                    model.generation + 1
            in
            ( { model | generation = generation, save = Loading generation }
            , Api.saveSettings model.draft (Saved generation) (SaveFailed generation)
            )

        Saved generation document ->
            if model.generation /= generation then
                ( model, Effect.none )

            else
                ( { model | save = Success generation document, draft = document.settings }, Effect.none )

        SaveFailed generation error ->
            if model.generation /= generation then
                ( model, Effect.none )

            else
                ( { model | save = Failure generation error }, Effect.none )


draft : (Settings -> Settings) -> Model -> ( Model, Effect Msg )
draft transform model =
    ( { model | draft = transform model.draft, save = NotAsked }, Effect.none )


view : Model -> Html Msg
view model =
    main_ [ class "settings-page" ]
        [ header [ class "settings-heading" ]
            [ span [ class "eyebrow" ] [ text "Local configuration" ]
            , h1 [] [ text "Hunker settings" ]
            , p [] [ text "These defaults live with the Rust server, so every browser and tab shares them." ]
            ]
        , case model.load of
            Loading _ ->
                state "Loading settings…" "Reading the server-owned settings document."

            Failure _ error ->
                section [ class "page-state is-error" ] [ h1 [] [ text "Could not load settings" ], p [] [ text error ] ]

            _ ->
                settingsForm model
        ]


settingsForm : Model -> Html Msg
settingsForm model =
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
            [ saveFeedback model.save
            , button [ type_ "submit", disabled (isSaving model.save) ]
                [ text
                    (if isSaving model.save then
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


saveFeedback : Remote Int String SettingsDocument -> Html Msg
saveFeedback remote =
    case remote of
        Success _ document ->
            span [ class "save-feedback is-success" ] [ text ("Saved to " ++ document.configPath) ]

        Failure _ error ->
            span [ class "save-feedback is-error" ] [ text error ]

        _ ->
            text ""


isSaving : Remote Int String SettingsDocument -> Bool
isSaving remote =
    case remote of
        Loading _ ->
            True

        _ ->
            False


state : String -> String -> Html Msg
state title detail =
    section [ class "page-state" ] [ span [ class "loading-spinner" ] [], h1 [] [ text title ], p [] [ text detail ] ]
