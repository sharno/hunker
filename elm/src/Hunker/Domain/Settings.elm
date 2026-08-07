module Hunker.Domain.Settings exposing
    ( InlineDiffMode(..)
    , ReviewScope(..)
    , Settings
    , SettingsDocument
    , ViewMode(..)
    , decoder
    , default
    , documentDecoder
    , encode
    , inlineDiffModeFromString
    , inlineDiffModeToString
    , reviewScopeToString
    , viewModeToString
    )

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


type alias Settings =
    { repositoriesRoot : String
    , cacheRoot : String
    , reviewScope : ReviewScope
    , viewMode : ViewMode
    , ignoreWhitespace : Bool
    , semantic : Bool
    , inlineDiffMode : InlineDiffMode
    , syntaxHighlighting : Bool
    , sidebarCollapsed : Bool
    , showGitHubReviews : Bool
    }


type alias SettingsDocument =
    { settings : Settings
    , configPath : String
    }


default : Settings
default =
    { repositoriesRoot = "~/src"
    , cacheRoot = "/tmp/hunker/repositories"
    , reviewScope = OneFile
    , viewMode = Split
    , ignoreWhitespace = True
    , semantic = True
    , inlineDiffMode = Token
    , syntaxHighlighting = True
    , sidebarCollapsed = False
    , showGitHubReviews = True
    }


documentDecoder : Decoder SettingsDocument
documentDecoder =
    Decode.map2 SettingsDocument
        (Decode.field "settings" decoder)
        (Decode.field "configPath" Decode.string)


decoder : Decoder Settings
decoder =
    Decode.map8
        (\repositoriesRoot cacheRoot reviewScope viewMode ignoreWhitespace semantic inlineDiffMode syntaxHighlighting ->
            { repositoriesRoot = repositoriesRoot
            , cacheRoot = cacheRoot
            , reviewScope = reviewScope
            , viewMode = viewMode
            , ignoreWhitespace = ignoreWhitespace
            , semantic = semantic
            , inlineDiffMode = inlineDiffMode
            , syntaxHighlighting = syntaxHighlighting
            , sidebarCollapsed = False
            , showGitHubReviews = True
            }
        )
        (Decode.field "repositoriesRoot" Decode.string)
        (Decode.field "cacheRoot" Decode.string)
        (Decode.field "reviewScope" (enumDecoder [ ( "file", OneFile ), ( "full", FullDiff ) ]))
        (Decode.field "viewMode" (enumDecoder [ ( "unified", Unified ), ( "split", Split ) ]))
        (Decode.field "ignoreWhitespace" Decode.bool)
        (Decode.field "semantic" Decode.bool)
        (Decode.field "inlineDiffMode" (enumDecoder [ ( "token", Token ), ( "character", Character ), ( "off", InlineOff ) ]))
        (Decode.field "syntaxHighlighting" Decode.bool)
        |> Decode.andThen
            (\partial ->
                Decode.map2
                    (\sidebarCollapsed showGitHubReviews ->
                        { partial
                            | sidebarCollapsed = sidebarCollapsed
                            , showGitHubReviews = showGitHubReviews
                        }
                    )
                    (Decode.field "sidebarCollapsed" Decode.bool)
                    (Decode.field "showGitHubReviews" Decode.bool)
            )


encode : Settings -> Encode.Value
encode settings =
    Encode.object
        [ ( "repositoriesRoot", Encode.string settings.repositoriesRoot )
        , ( "cacheRoot", Encode.string settings.cacheRoot )
        , ( "reviewScope", Encode.string (reviewScopeToString settings.reviewScope) )
        , ( "viewMode", Encode.string (viewModeToString settings.viewMode) )
        , ( "ignoreWhitespace", Encode.bool settings.ignoreWhitespace )
        , ( "semantic", Encode.bool settings.semantic )
        , ( "inlineDiffMode", Encode.string (inlineDiffModeToString settings.inlineDiffMode) )
        , ( "syntaxHighlighting", Encode.bool settings.syntaxHighlighting )
        , ( "sidebarCollapsed", Encode.bool settings.sidebarCollapsed )
        , ( "showGitHubReviews", Encode.bool settings.showGitHubReviews )
        ]


reviewScopeToString : ReviewScope -> String
reviewScopeToString scope =
    case scope of
        OneFile ->
            "file"

        FullDiff ->
            "full"


viewModeToString : ViewMode -> String
viewModeToString mode =
    case mode of
        Unified ->
            "unified"

        Split ->
            "split"


inlineDiffModeToString : InlineDiffMode -> String
inlineDiffModeToString mode =
    case mode of
        Token ->
            "token"

        Character ->
            "character"

        InlineOff ->
            "off"


inlineDiffModeFromString : String -> InlineDiffMode
inlineDiffModeFromString value =
    case value of
        "character" ->
            Character

        "off" ->
            InlineOff

        _ ->
            Token


enumDecoder : List ( String, value ) -> Decoder value
enumDecoder values =
    Decode.string
        |> Decode.andThen
            (\encoded ->
                values
                    |> List.filter (Tuple.first >> (==) encoded)
                    |> List.head
                    |> Maybe.map (Tuple.second >> Decode.succeed)
                    |> Maybe.withDefault (Decode.fail ("Unknown enum value: " ++ encoded))
            )
