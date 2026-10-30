module Hunker.Review.View.Toolbar exposing (Config, PullTabs, view)

import Html exposing (Html, button, div, input, label, option, section, select, span, text)
import Html.Attributes exposing (attribute, checked, class, classList, selected, type_, value)
import Html.Events exposing (onCheck, onClick, onInput)
import Hunker.Domain.Settings as Settings exposing (Change, Settings, Toggle(..))
import Hunker.Review.DiffView exposing (SearchMode(..))
import Hunker.View.Settings as SettingsView
import Json.Decode as Decode


{-| Only pull requests have a commits tab and GitHub review threads.
-}
type alias PullTabs msg =
    { filesActive : Bool
    , selectFiles : msg
    , selectCommits : msg
    }


type alias Config msg =
    { settings : Settings
    , pullTabs : Maybe (PullTabs msg)
    , filter : String
    , searchMode : SearchMode
    , changeFilter : String -> msg
    , selectSearchMode : SearchMode -> msg
    , changeSetting : Change -> msg
    , optionsOpen : Bool
    , toggleOptions : msg
    , closeOptions : msg
    }


view : Config msg -> Html msg
view config =
    section [ classList [ ( "compact-review-toolbar", True ), ( "options-open", config.optionsOpen ) ] ]
        [ if config.optionsOpen then
            button [ type_ "button", class "diff-options-backdrop", attribute "aria-label" "Close diff options", onClick config.closeOptions ] []

          else
            text ""
        , div [ class "review-tab-picker" ]
            (case config.pullTabs of
                Just tabs ->
                    [ segment tabs.filesActive tabs.selectFiles "Files"
                    , segment (not tabs.filesActive) tabs.selectCommits "Commits"
                    ]

                Nothing ->
                    [ span [ class "segmented-button is-active" ] [ text "Files" ] ]
            )
        , label [ class "review-search" ]
            [ span [] [ text "⌕" ]
            , select [ onSearchMode config.selectSearchMode ]
                [ option [ value "literal", selected (config.searchMode == Literal) ] [ text "Text" ]
                , option [ value "regex", selected (config.searchMode == Regex) ] [ text "Regex" ]
                ]
            , input [ type_ "search", attribute "aria-label" "Search this change", attribute "placeholder" "Search this change", value config.filter, onInput config.changeFilter ] []
            ]
        , button
            [ type_ "button"
            , class "diff-options-trigger"
            , attribute "aria-label" "Diff options"
            , attribute "aria-expanded"
                (if config.optionsOpen then
                    "true"

                 else
                    "false"
                )
            , onClick config.toggleOptions
            ]
            [ text "Diff options" ]
        , div [ class "diff-options" ]
            ([ select [ attribute "aria-label" "Diff scope", SettingsView.onSelect Settings.scopeSelect config.changeSetting ]
                (SettingsView.options Settings.scopeSelect .short config.settings)
             , select [ attribute "aria-label" "Diff layout", SettingsView.onSelect Settings.layoutSelect config.changeSetting ]
                (SettingsView.options Settings.layoutSelect .short config.settings)
             , toggle config WhitespaceToggle
             , toggle config SemanticToggle
             , select [ attribute "aria-label" "Inline diff", SettingsView.onSelect Settings.inlineSelect config.changeSetting ]
                (SettingsView.options Settings.inlineSelect .short config.settings)
             , toggle config SyntaxToggle
             , toggle config DiffColorsToggle
             ]
                ++ (case config.pullTabs of
                        Just _ ->
                            [ toggle config ReviewsToggle ]

                        Nothing ->
                            []
                   )
            )
        ]


toggle : Config msg -> Toggle -> Html msg
toggle config control =
    let
        on =
            Settings.toggleIsOn control config.settings
    in
    label [ classList [ ( "filter-toggle", True ), ( "is-active", on ) ] ]
        [ input [ type_ "checkbox", checked on, onCheck (Settings.toggleChange control >> config.changeSetting) ] []
        , span [ class "toggle-dot" ] []
        , text (Settings.toggleLabel control).short
        ]


segment : Bool -> msg -> String -> Html msg
segment active message labelText =
    button [ type_ "button", classList [ ( "segmented-button", True ), ( "is-active", active ) ], onClick message ] [ text labelText ]


onSearchMode : (SearchMode -> msg) -> Html.Attribute msg
onSearchMode toMsg =
    Html.Events.on "change"
        (Html.Events.targetValue
            |> Decode.andThen
                (\key ->
                    case key of
                        "literal" ->
                            Decode.succeed (toMsg Literal)

                        "regex" ->
                            Decode.succeed (toMsg Regex)

                        _ ->
                            Decode.fail ("Unknown search mode: " ++ key)
                )
        )
