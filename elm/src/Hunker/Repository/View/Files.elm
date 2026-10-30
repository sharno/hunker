module Hunker.Repository.View.Files exposing (Config, ReadyConfig, State(..), view)

import Html exposing (Html, aside, button, code, div, h1, h2, header, mark, p, pre, section, small, span, strong, text)
import Html.Attributes exposing (class, classList, style, type_)
import Html.Events exposing (onClick)
import Hunker.ApiError as ApiError
import Hunker.Domain.Repository exposing (File, SearchMatch, SearchMode(..))
import Hunker.Domain.Settings exposing (Feature)
import Hunker.FileTree as FileTree exposing (Tree(..))
import Hunker.Remote exposing (Remote(..))
import Hunker.Repository.Files as Files
import Hunker.Repository.View.Local as Local
import Hunker.Route exposing (OpenFile, Search(..))
import Hunker.SourceView as SourceView


type alias Config msg =
    { state : State msg }


type State msg
    = LocalUnavailable (Local.Unavailable msg)
    | FilesReady (ReadyConfig msg)


type alias ReadyConfig msg =
    { syntaxHighlighting : Feature
    , openFile : Maybe OpenFile
    , search : Search
    , files : Files.Model
    , selectedFile : String -> msg
    , selectedMatch : String -> Int -> msg
    , closedFile : msg
    , toggledFolder : String -> msg
    , toggledSourceFold : String -> msg
    }


view : Config msg -> Html msg
view config =
    case config.state of
        LocalUnavailable unavailable ->
            Local.viewUnavailable unavailable

        FilesReady ready ->
            readyView ready


readyView : ReadyConfig msg -> Html msg
readyView config =
    let
        forest =
            Files.tree config.files
    in
    div [ class "repository-workspace" ]
        [ aside [ class "repository-file-sidebar" ]
            [ header [] [ strong [] [ text "Files" ], span [ class "count-badge" ] [ text (String.fromInt (leafCount forest)) ] ]
            , treeView config forest
            ]
        , section [ class "repository-results" ]
            [ case ( config.openFile, config.search ) of
                ( Just file, _ ) ->
                    fileView config file

                ( Nothing, Search query mode ) ->
                    searchView config query mode

                ( Nothing, NoSearch ) ->
                    div [ class "repository-empty-selection" ]
                        [ h1 [] [ text "Choose a file" ]
                        , p [] [ text "Browse the collapsed tree or search literal text, regular expressions, or FFF fuzzy matches." ]
                        ]
            ]
        ]


treeView : ReadyConfig msg -> List (Tree File) -> Html msg
treeView config forest =
    div [ class "file-tree" ] (List.map (treeNode config 0) forest)


treeNode : ReadyConfig msg -> Int -> Tree File -> Html msg
treeNode config depth tree =
    case tree of
        Folder name path children ->
            let
                collapsed =
                    Files.isFolderCollapsed path config.files
            in
            div [ class "file-tree-folder" ]
                [ button
                    [ type_ "button"
                    , class "folder-row"
                    , style "padding-left" (String.fromInt (depth * 16 + 10) ++ "px")
                    , onClick (config.toggledFolder path)
                    ]
                    [ span []
                        [ text
                            (if collapsed then
                                "›"

                             else
                                "⌄"
                            )
                        ]
                    , strong [] [ text name ]
                    , small [] [ text (String.fromInt (leafCount children)) ]
                    ]
                , if collapsed then
                    text ""

                  else
                    div [] (List.map (treeNode config (depth + 1)) children)
                ]

        Leaf name file ->
            button
                [ type_ "button"
                , classList [ ( "repository-file-row", True ), ( "is-active", Maybe.map .path config.openFile == Just file.path ) ]
                , style "padding-left" (String.fromInt (depth * 16 + 28) ++ "px")
                , onClick (config.selectedFile file.path)
                ]
                [ span [ class "file-status is-clean" ] [ text "·" ]
                , strong [] [ text name ]
                , small [] [ text (formatSize file.size) ]
                ]


leafCount : List (Tree item) -> Int
leafCount forest =
    List.sum
        (List.map
            (\tree ->
                case tree of
                    Leaf _ _ ->
                        1

                    Folder _ _ children ->
                        leafCount children
            )
            forest
        )


fileView : ReadyConfig msg -> OpenFile -> Html msg
fileView config { path, line } =
    case Files.selectedFile config.files of
        Loading _ ->
            Local.pageState ("Opening " ++ path ++ "…") ""

        Failure _ error ->
            Local.errorState "Could not open file" error

        Success _ file ->
            section [ class "repository-file-view" ]
                [ div [ class "repository-file-heading" ]
                    [ button [ type_ "button", class "commit-back", onClick config.closedFile ]
                        [ text
                            (case config.search of
                                NoSearch ->
                                    "← File list"

                                Search _ _ ->
                                    "← Search results"
                            )
                        ]
                    , strong [] [ text file.path ]
                    , if file.truncated then
                        span [] [ text "First 500k characters shown" ]

                      else
                        text ""
                    ]
                , pre [ class "repository-source" ]
                    [ code []
                        (SourceView.file
                            { syntax = config.syntaxHighlighting
                            , namespace = file.path
                            , target = line
                            , presentation = file.presentation
                            , isCollapsed = \fold -> Files.isSourceFoldCollapsed fold config.files
                            , toggleFold = config.toggledSourceFold
                            }
                            file.content
                        )
                    ]
                ]

        NotAsked ->
            Local.pageState ("Opening " ++ path ++ "…") ""


searchView : ReadyConfig msg -> String -> SearchMode -> Html msg
searchView config query mode =
    case Files.search config.files of
        Loading _ ->
            Local.pageState ("Searching for “" ++ query ++ "”…") (searchDescription mode)

        Failure _ error ->
            Local.errorState "Search failed" error

        Success _ results ->
            div [ class "repository-search-results" ]
                [ section []
                    [ h2 [] [ text ("Filename matches · " ++ String.fromInt (List.length results.files)) ]
                    , div [ class "repository-filename-results" ]
                        (List.map
                            (\file ->
                                button [ type_ "button", class "repository-file-row", onClick (config.selectedFile file.path) ]
                                    [ strong [] [ text file.path ] ]
                            )
                            results.files
                        )
                    ]
                , section []
                    [ h2 [] [ text ("Content matches · " ++ String.fromInt (List.length results.matches)) ]
                    , div [ class "repository-content-results" ]
                        (List.map (searchMatchView config.selectedMatch) results.matches)
                    ]
                ]

        NotAsked ->
            Local.pageState ("Searching for “" ++ query ++ "”…") (searchDescription mode)


searchMatchView : (String -> Int -> msg) -> SearchMatch -> Html msg
searchMatchView selectedMatch match =
    let
        context lineText =
            span [ class "search-line" ] [ text lineText ]
    in
    button [ type_ "button", class "repository-search-match", onClick (selectedMatch match.path match.line) ]
        [ span [ class "repository-match-heading" ]
            [ strong [] [ text match.path ], code [] [ text (":" ++ String.fromInt match.line) ] ]
        , pre []
            [ code []
                (List.map context match.contextBefore
                    ++ span [ class "search-line is-match" ] (highlighted match.ranges match.lineContent)
                    :: List.map context match.contextAfter
                )
            ]
        ]


{-| Marks each matched range of one line.
-}
highlighted : List ( Int, Int ) -> String -> List (Html msg)
highlighted ranges lineText =
    let
        step ( start, end ) ( position, pieces ) =
            ( end
            , mark [] [ text (String.slice start end lineText) ]
                :: text (String.slice position start lineText)
                :: pieces
            )

        ( consumed, reversed ) =
            List.foldl step ( 0, [] ) ranges
    in
    List.reverse (text (String.dropLeft consumed lineText) :: reversed)


formatSize : Int -> String
formatSize size =
    if size > 1000000 then
        String.fromInt (size // 1000000) ++ " MB"

    else if size > 1000 then
        String.fromInt (size // 1000) ++ " KB"

    else
        String.fromInt size ++ " B"


searchDescription : SearchMode -> String
searchDescription mode =
    case mode of
        FuzzySearch ->
            "Ranking filenames with FFF and scanning nearby content."

        RegexSearch ->
            "Matching a regular expression with git grep."

        LiteralSearch ->
            "Matching literal text with git grep."
