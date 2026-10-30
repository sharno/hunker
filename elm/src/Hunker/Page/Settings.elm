module Hunker.Page.Settings exposing (Model, Msg(..), init, update, view)

{-| Edits to the shared settings. Pending edits are applied over the live
settings at view and submit time, so a change made elsewhere (such as hiding
the top bar) is never overwritten by a stale copy.
-}

import Html exposing (Html, button, div, form, h1, header, input, label, main_, p, section, select, span, text)
import Html.Attributes exposing (attribute, checked, class, disabled, type_, value)
import Html.Events exposing (onCheck, onInput, onSubmit)
import Hunker.ApiError as ApiError
import Hunker.Domain.Settings as Settings exposing (Change, Select, Settings, Toggle(..))
import Hunker.Settings.Sync as SettingsSync
import Hunker.View.Settings as SettingsView


type alias Model =
    { pending : List Change }


type Msg
    = Changed Change
    | Submitted


init : Model
init =
    { pending = [] }


{-| Returns the edits to persist when the form is submitted.
-}
update : Msg -> Model -> ( Model, List Change )
update msg model =
    case msg of
        Changed change ->
            ( { model | pending = model.pending ++ [ change ] }, [] )

        Submitted ->
            ( { model | pending = [] }, model.pending )


draft : Settings -> Model -> Settings
draft current model =
    List.foldl Settings.apply current model.pending


view : SettingsSync.Status -> Settings -> Model -> Html Msg
view status current model =
    main_ [ class "settings-page" ]
        [ header [ class "settings-heading" ]
            [ span [ class "eyebrow" ] [ text "Local configuration" ]
            , h1 [] [ text "Hunker settings" ]
            , p [] [ text "These defaults live with the Rust server, so every browser and tab shares them." ]
            ]
        , settingsForm status (draft current model)
        ]


settingsForm : SettingsSync.Status -> Settings -> Html Msg
settingsForm status settings =
    let
        saving =
            status == SettingsSync.SaveInProgress
    in
    form [ class "settings-form", onSubmit Submitted ]
        [ section [ class "settings-section" ]
            [ h1 [] [ text "Repository storage" ]
            , p [] [ text "Hunker discovers normal checkouts in the repos root and keeps disposable shallow clones in the cache root." ]
            , textField saving "Repositories root" settings.repositoriesRoot Settings.SetRepositoriesRoot
            , textField saving "Temporary clone root" settings.cacheRoot Settings.SetCacheRoot
            ]
        , section [ class "settings-section" ]
            (h1 [] [ text "Review defaults" ]
                :: selectField saving Settings.scopeSelect settings
                :: selectField saving Settings.layoutSelect settings
                :: selectField saving Settings.inlineSelect settings
                :: List.map (toggle saving settings)
                    [ WhitespaceToggle, SemanticToggle, SyntaxToggle, DiffColorsToggle, SidebarToggle, ReviewsToggle, TopBarToggle ]
            )
        , div [ class "settings-actions" ]
            [ saveFeedback status
            , button [ type_ "submit", disabled saving ]
                [ text
                    (if saving then
                        "Saving…"

                     else
                        "Save settings"
                    )
                ]
            ]
        ]


textField : Bool -> String -> String -> (String -> Change) -> Html Msg
textField saving title current toChange =
    label [ class "settings-field" ]
        [ span [] [ text title ]
        , input [ type_ "text", value current, disabled saving, onInput (toChange >> Changed) ] []
        ]


selectField : Bool -> Select a -> Settings -> Html Msg
selectField saving control settings =
    label [ class "settings-field" ]
        [ span [] [ text control.title ]
        , select [ disabled saving, SettingsView.onSelect control Changed ] (SettingsView.options control .label settings)
        ]


toggle : Bool -> Settings -> Toggle -> Html Msg
toggle saving settings control =
    let
        copy =
            Settings.toggleLabel control
    in
    label [ class "settings-toggle" ]
        [ input [ type_ "checkbox", checked (Settings.toggleIsOn control settings), disabled saving, onCheck (Settings.toggleChange control >> Changed) ] []
        , span [] [ Html.strong [] [ text copy.title ], Html.small [] [ text copy.hint ] ]
        ]


saveFeedback : SettingsSync.Status -> Html Msg
saveFeedback status =
    case status of
        SettingsSync.Saved path ->
            span [ class "save-feedback is-success" ] [ text ("Saved to " ++ path) ]

        SettingsSync.SaveFailed error ->
            span [ class "save-feedback is-error", attribute "role" "alert" ] [ text (ApiError.message error) ]

        SettingsSync.SaveInProgress ->
            text ""
