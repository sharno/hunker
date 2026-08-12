module Hunker.Review.View.Toolbar exposing (Config, view)

import Html exposing (Html, button, div, input, label, option, section, select, span, text)
import Html.Attributes exposing (attribute, checked, class, selected, type_, value)
import Html.Events exposing (onCheck, onClick, onInput)
import Hunker.Domain.Settings as Settings exposing (InlineDiffMode(..), ReviewScope(..), Settings, ViewMode(..))
import Hunker.Review.DiffView exposing (SearchMode(..))
import Hunker.Route exposing (ReviewTab(..))


type alias Config msg =
    { settings : Settings
    , pullRequest : Bool
    , tab : ReviewTab
    , filter : String
    , searchMode : SearchMode
    , selectTab : ReviewTab -> msg
    , changeFilter : String -> msg
    , selectSearchMode : SearchMode -> msg
    , selectScope : ReviewScope -> msg
    , selectViewMode : ViewMode -> msg
    , toggleWhitespace : Bool -> msg
    , toggleSemantic : Bool -> msg
    , selectInlineMode : InlineDiffMode -> msg
    , toggleSyntax : Bool -> msg
    , toggleDiffColors : Bool -> msg
    , toggleReviews : Bool -> msg
    }


view : Config msg -> Html msg
view config =
    section [ class "compact-review-toolbar" ]
        [ div [ class "review-tab-picker" ]
            [ segment (config.tab == ReviewFiles) (config.selectTab ReviewFiles) "Files"
            , if config.pullRequest then
                segment (config.tab == ReviewCommits) (config.selectTab ReviewCommits) "Commits"

              else
                text ""
            ]
        , label [ class "review-search" ]
            [ span [] [ text "⌕" ]
            , select [ onInput (searchModeFromString >> config.selectSearchMode) ]
                [ option [ value "literal", selected (config.searchMode == Literal) ] [ text "Text" ]
                , option [ value "regex", selected (config.searchMode == Regex) ] [ text "Regex" ]
                ]
            , input [ type_ "search", attribute "aria-label" "Search this change", attribute "placeholder" "Search this change", value config.filter, onInput config.changeFilter ] []
            ]
        , div [ class "diff-options" ]
            [ select [ attribute "aria-label" "Diff scope", onInput (scopeFromString >> config.selectScope) ]
                [ option [ value "file", selected (config.settings.reviewScope == OneFile) ] [ text "One file" ]
                , option [ value "full", selected (config.settings.reviewScope == FullDiff) ] [ text "Full diff" ]
                ]
            , select [ attribute "aria-label" "Diff layout", onInput (viewModeFromString >> config.selectViewMode) ]
                [ option [ value "split", selected (config.settings.viewMode == Split) ] [ text "Side by side" ]
                , option [ value "unified", selected (config.settings.viewMode == Unified) ] [ text "Unified" ]
                ]
            , toggle "Ignore whitespace" config.settings.ignoreWhitespace config.toggleWhitespace
            , toggle "Semantic" config.settings.semantic config.toggleSemantic
            , select [ attribute "aria-label" "Inline diff", onInput (Settings.inlineDiffModeFromString >> config.selectInlineMode) ]
                [ option [ value "token", selected (config.settings.inlineDiffMode == Token) ] [ text "Word diff" ]
                , option [ value "character", selected (config.settings.inlineDiffMode == Character) ] [ text "Character diff" ]
                , option [ value "off", selected (config.settings.inlineDiffMode == InlineOff) ] [ text "Inline off" ]
                ]
            , toggle "Syntax" config.settings.syntaxHighlighting config.toggleSyntax
            , toggle "Diff colors" config.settings.diffColors config.toggleDiffColors
            , if config.pullRequest then
                toggle "GitHub reviews" config.settings.showGitHubReviews config.toggleReviews

              else
                text ""
            ]
        ]


toggle : String -> Bool -> (Bool -> msg) -> Html msg
toggle labelText current toMsg =
    label [ class ("filter-toggle" ++ activeClass current) ]
        [ input [ type_ "checkbox", checked current, onCheck toMsg ] []
        , span [ class "toggle-dot" ] []
        , text labelText
        ]


segment : Bool -> msg -> String -> Html msg
segment active message labelText =
    button [ type_ "button", class ("segmented-button" ++ activeClass active), onClick message ] [ text labelText ]


scopeFromString : String -> ReviewScope
scopeFromString encoded =
    if encoded == "full" then
        FullDiff

    else
        OneFile


viewModeFromString : String -> ViewMode
viewModeFromString encoded =
    if encoded == "unified" then
        Unified

    else
        Split


searchModeFromString : String -> SearchMode
searchModeFromString encoded =
    if encoded == "regex" then
        Regex

    else
        Literal


activeClass : Bool -> String
activeClass active =
    if active then
        " is-active"

    else
        ""
