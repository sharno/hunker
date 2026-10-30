module Hunker.Domain.Settings exposing
    ( AnalysisOptions
    , Change(..)
    , Choice
    , Feature(..)
    , InlineDiffMode(..)
    , ReviewScope(..)
    , Select
    , Settings
    , SettingsDocument
    , Toggle(..)
    , ViewMode(..)
    , Visibility(..)
    , Whitespace(..)
    , analysisOptions
    , apply
    , decoder
    , documentDecoder
    , encode
    , inlineDiffModeToString
    , inlineSelect
    , layoutSelect
    , requestsAnalysis
    , scopeSelect
    , toggleChange
    , toggleIsOn
    , toggleLabel
    )

import Hunker.Decode exposing (andMap)
import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode


type ReviewScope
    = OneFile
    | FullDiff


type ViewMode
    = Unified
    | Split


type InlineDiffMode
    = Token
    | Character
    | InlineOff


type Whitespace
    = IgnoreWhitespace
    | ShowWhitespace


type Feature
    = Enabled
    | Disabled


type Visibility
    = Expanded
    | Collapsed


type alias Settings =
    { repositoriesRoot : String
    , cacheRoot : String
    , reviewScope : ReviewScope
    , viewMode : ViewMode
    , whitespace : Whitespace
    , semantic : Feature
    , inlineDiffMode : InlineDiffMode
    , syntaxHighlighting : Feature
    , diffColors : Feature
    , sidebar : Visibility
    , gitHubReviews : Feature
    , topBar : Visibility
    }


type alias SettingsDocument =
    { settings : Settings
    , configPath : String
    }


{-| Every settings edit, from any page. `apply` is the only interpreter, so
pages describe intent instead of rewriting the settings record.
-}
type Change
    = SetRepositoriesRoot String
    | SetCacheRoot String
    | SetReviewScope ReviewScope
    | SetViewMode ViewMode
    | SetWhitespace Whitespace
    | SetSemantic Feature
    | SetInlineDiffMode InlineDiffMode
    | SetSyntaxHighlighting Feature
    | SetDiffColors Feature
    | SetSidebar Visibility
    | SetGitHubReviews Feature
    | SetTopBar Visibility


apply : Change -> Settings -> Settings
apply change settings =
    case change of
        SetRepositoriesRoot value ->
            { settings | repositoriesRoot = value }

        SetCacheRoot value ->
            { settings | cacheRoot = value }

        SetReviewScope value ->
            { settings | reviewScope = value }

        SetViewMode value ->
            { settings | viewMode = value }

        SetWhitespace value ->
            { settings | whitespace = value }

        SetSemantic value ->
            { settings | semantic = value }

        SetInlineDiffMode value ->
            { settings | inlineDiffMode = value }

        SetSyntaxHighlighting value ->
            { settings | syntaxHighlighting = value }

        SetDiffColors value ->
            { settings | diffColors = value }

        SetSidebar value ->
            { settings | sidebar = value }

        SetGitHubReviews value ->
            { settings | gitHubReviews = value }

        SetTopBar value ->
            { settings | topBar = value }


{-| The settings that select a server-side review analysis snapshot.
-}
type alias AnalysisOptions =
    { whitespace : Whitespace
    , semantic : Feature
    , syntax : Feature
    , inlineDiff : InlineDiffMode
    }


analysisOptions : Settings -> AnalysisOptions
analysisOptions settings =
    { whitespace = settings.whitespace
    , semantic = settings.semantic
    , syntax = settings.syntaxHighlighting
    , inlineDiff = settings.inlineDiffMode
    }


requestsAnalysis : AnalysisOptions -> Bool
requestsAnalysis options =
    options.semantic == Enabled || options.syntax == Enabled || options.inlineDiff /= InlineOff



-- CONTROLS


{-| An on/off setting rendered as a checkbox.
-}
type Toggle
    = WhitespaceToggle
    | SemanticToggle
    | SyntaxToggle
    | DiffColorsToggle
    | SidebarToggle
    | ReviewsToggle
    | TopBarToggle


toggleIsOn : Toggle -> Settings -> Bool
toggleIsOn control settings =
    case control of
        WhitespaceToggle ->
            settings.whitespace == IgnoreWhitespace

        SemanticToggle ->
            settings.semantic == Enabled

        SyntaxToggle ->
            settings.syntaxHighlighting == Enabled

        DiffColorsToggle ->
            settings.diffColors == Enabled

        SidebarToggle ->
            settings.sidebar == Collapsed

        ReviewsToggle ->
            settings.gitHubReviews == Enabled

        TopBarToggle ->
            settings.topBar == Collapsed


toggleChange : Toggle -> Bool -> Change
toggleChange control on =
    let
        feature =
            if on then
                Enabled

            else
                Disabled

        collapsed =
            if on then
                Collapsed

            else
                Expanded
    in
    case control of
        WhitespaceToggle ->
            SetWhitespace
                (if on then
                    IgnoreWhitespace

                 else
                    ShowWhitespace
                )

        SemanticToggle ->
            SetSemantic feature

        SyntaxToggle ->
            SetSyntaxHighlighting feature

        DiffColorsToggle ->
            SetDiffColors feature

        SidebarToggle ->
            SetSidebar collapsed

        ReviewsToggle ->
            SetGitHubReviews feature

        TopBarToggle ->
            SetTopBar collapsed


toggleLabel : Toggle -> { title : String, short : String, hint : String }
toggleLabel control =
    case control of
        WhitespaceToggle ->
            { title = "Ignore whitespace", short = "Ignore whitespace", hint = "Hide whitespace-only replacements." }

        SemanticToggle ->
            { title = "Semantic analysis", short = "Semantic", hint = "Parse syntax trees and detect moved declarations." }

        SyntaxToggle ->
            { title = "Syntax highlighting", short = "Syntax", hint = "Color supported source languages in repository and diff views." }

        DiffColorsToggle ->
            { title = "Diff colors", short = "Diff colors", hint = "Use addition, deletion, and inline-change backgrounds in diff views." }

        SidebarToggle ->
            { title = "Collapse review sidebar", short = "Collapse sidebar", hint = "Start reviews with maximum horizontal space." }

        ReviewsToggle ->
            { title = "Show GitHub reviews", short = "GitHub reviews", hint = "Load and render inline review conversations." }

        TopBarToggle ->
            { title = "Hide top bar", short = "Hide top bar", hint = "Start with the main navigation hidden; use the floating control to restore it." }


{-| One option of a select control: its value, wire key, and labels.
-}
type alias Choice a =
    { value : a
    , key : String
    , label : String
    , short : String
    }


{-| A select control. Views parse the chosen key by looking it up in
`choices`, so an unknown key is never coerced into a default.
-}
type alias Select a =
    { title : String
    , choices : List (Choice a)
    , current : Settings -> a
    , change : a -> Change
    }


scopeSelect : Select ReviewScope
scopeSelect =
    { title = "Scope"
    , choices =
        [ choice OneFile reviewScopeKey "One file" "One file"
        , choice FullDiff reviewScopeKey "Full diff" "Full diff"
        ]
    , current = .reviewScope
    , change = SetReviewScope
    }


layoutSelect : Select ViewMode
layoutSelect =
    { title = "Layout"
    , choices =
        [ choice Split viewModeKey "Side by side" "Side by side"
        , choice Unified viewModeKey "Unified" "Unified"
        ]
    , current = .viewMode
    , change = SetViewMode
    }


inlineSelect : Select InlineDiffMode
inlineSelect =
    { title = "Inline diff"
    , choices = inlineChoices
    , current = .inlineDiffMode
    , change = SetInlineDiffMode
    }


inlineChoices : List (Choice InlineDiffMode)
inlineChoices =
    [ choice Token inlineDiffModeToString "Word / token" "Word diff"
    , choice Character inlineDiffModeToString "Character" "Character diff"
    , choice InlineOff inlineDiffModeToString "Off" "Inline off"
    ]


choice : a -> (a -> String) -> String -> String -> Choice a
choice value toKey label short =
    { value = value, key = toKey value, label = label, short = short }


reviewScopeKey : ReviewScope -> String
reviewScopeKey scope =
    case scope of
        OneFile ->
            "file"

        FullDiff ->
            "full"


viewModeKey : ViewMode -> String
viewModeKey mode =
    case mode of
        Split ->
            "split"

        Unified ->
            "unified"


inlineDiffModeToString : InlineDiffMode -> String
inlineDiffModeToString mode =
    case mode of
        Token ->
            "token"

        Character ->
            "character"

        InlineOff ->
            "off"



-- WIRE FORMAT


keyed : List (Choice a) -> List ( String, a )
keyed =
    List.map (\option -> ( option.key, option.value ))


documentDecoder : Decoder SettingsDocument
documentDecoder =
    Decode.map2 SettingsDocument
        (Decode.field "settings" decoder)
        (Decode.field "configPath" Decode.string)


{-| The settings file stores switches as booleans; they become closed types
here and nowhere else.
-}
decoder : Decoder Settings
decoder =
    let
        flag field onTrue onFalse =
            Decode.field field
                (Decode.map
                    (\on ->
                        if on then
                            onTrue

                        else
                            onFalse
                    )
                    Decode.bool
                )
    in
    Decode.succeed Settings
        |> andMap (Decode.field "repositoriesRoot" Decode.string)
        |> andMap (Decode.field "cacheRoot" Decode.string)
        |> andMap (Decode.field "reviewScope" (Hunker.Decode.enum "review scope" (keyed scopeSelect.choices)))
        |> andMap (Decode.field "viewMode" (Hunker.Decode.enum "view mode" (keyed layoutSelect.choices)))
        |> andMap (flag "ignoreWhitespace" IgnoreWhitespace ShowWhitespace)
        |> andMap (flag "semantic" Enabled Disabled)
        |> andMap (Decode.field "inlineDiffMode" (Hunker.Decode.enum "inline diff mode" (keyed inlineChoices)))
        |> andMap (flag "syntaxHighlighting" Enabled Disabled)
        |> andMap (flag "diffColors" Enabled Disabled)
        |> andMap (flag "sidebarCollapsed" Collapsed Expanded)
        |> andMap (flag "showGitHubReviews" Enabled Disabled)
        |> andMap (flag "topBarCollapsed" Collapsed Expanded)


encode : Settings -> Encode.Value
encode settings =
    Encode.object
        [ ( "repositoriesRoot", Encode.string settings.repositoriesRoot )
        , ( "cacheRoot", Encode.string settings.cacheRoot )
        , ( "reviewScope", Encode.string (reviewScopeKey settings.reviewScope) )
        , ( "viewMode", Encode.string (viewModeKey settings.viewMode) )
        , ( "ignoreWhitespace", Encode.bool (settings.whitespace == IgnoreWhitespace) )
        , ( "semantic", Encode.bool (settings.semantic == Enabled) )
        , ( "inlineDiffMode", Encode.string (inlineDiffModeToString settings.inlineDiffMode) )
        , ( "syntaxHighlighting", Encode.bool (settings.syntaxHighlighting == Enabled) )
        , ( "diffColors", Encode.bool (settings.diffColors == Enabled) )
        , ( "sidebarCollapsed", Encode.bool (settings.sidebar == Collapsed) )
        , ( "showGitHubReviews", Encode.bool (settings.gitHubReviews == Enabled) )
        , ( "topBarCollapsed", Encode.bool (settings.topBar == Collapsed) )
        ]
