module Hunker.Repository.View.Files exposing (Config, ReadyConfig, State(..), view)

import Html exposing (Html, aside, button, code, div, h1, h2, header, p, pre, section, small, span, strong, text)
import Html.Attributes exposing (attribute, class, type_)
import Html.Events exposing (onClick)
import Hunker.ApiError as ApiError
import Hunker.Domain.Repository as Repository exposing (File, SearchMatch)
import Hunker.FileTree as FileTree exposing (Tree(..))
import Hunker.Remote exposing (Remote(..))
import Hunker.Repository.Files as Files
import Hunker.Repository.View.Local as Local
import Hunker.Route exposing (SearchMode(..))
import Hunker.Syntax as Syntax


type alias Config msg =
    { state : State msg }


type State msg
    = LocalUnavailable (Local.Unavailable msg)
    | FilesReady (ReadyConfig msg)


type alias ReadyConfig msg =
    { syntaxHighlighting : Bool
    , selectedPath : Maybe String
    , query : String
    , searchMode : SearchMode
    , files : Files.Model
    , selectedFile : String -> msg
    , closedFile : msg
    , toggledFolder : String -> msg
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
        catalog =
            Files.catalog config.files
    in
    div [ class "repository-workspace" ]
        [ aside [ class "repository-file-sidebar" ]
            [ header [] [ strong [] [ text "Files" ], span [ class "count-badge" ] [ text (String.fromInt (List.length catalog)) ] ]
            , treeView config (FileTree.build .path catalog)
            ]
        , section [ class "repository-results" ]
            [ case config.selectedPath of
                Just _ ->
                    fileView config

                Nothing ->
                    if config.query /= "" then
                        searchView config

                    else
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
                    , attribute "style" ("padding-left:" ++ String.fromInt (depth * 16 + 10) ++ "px")
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
                , class
                    ("repository-file-row"
                        ++ (if config.selectedPath == Just file.path then
                                " is-active"

                            else
                                ""
                           )
                    )
                , attribute "style" ("padding-left:" ++ String.fromInt (depth * 16 + 28) ++ "px")
                , onClick (config.selectedFile file.path)
                ]
                [ span [ class ("file-status is-" ++ file.gitStatus) ] [ text (statusMark file.gitStatus) ]
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


fileView : ReadyConfig msg -> Html msg
fileView config =
    case Files.selectedFile config.files of
        Loading _ ->
            Local.pageState ("Opening " ++ Maybe.withDefault "file" config.selectedPath ++ "…") ""

        Failure _ error ->
            section [ class "page-state is-error" ] [ h1 [] [ text "Could not open file" ], p [] [ text (ApiError.message error) ] ]

        Success _ file ->
            section [ class "repository-file-view" ]
                [ div [ class "repository-file-heading" ]
                    [ button [ type_ "button", class "commit-back", onClick config.closedFile ]
                        [ text
                            (if config.query == "" then
                                "← File list"

                             else
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
                        (file.content
                            |> String.lines
                            |> List.indexedMap
                                (\index sourceLine ->
                                    span [ class "source-line" ]
                                        [ span [ class "line-number" ] [ text (String.fromInt (index + 1)) ]
                                        , span [ class "line-code" ] (Syntax.line config.syntaxHighlighting file.path sourceLine)
                                        ]
                                )
                        )
                    ]
                ]

        NotAsked ->
            text ""


searchView : ReadyConfig msg -> Html msg
searchView config =
    case Files.search config.files of
        Loading _ ->
            Local.pageState ("Searching for “" ++ config.query ++ "”…") (searchDescription config.searchMode)

        Failure _ error ->
            section [ class "page-state is-error" ] [ h1 [] [ text "Search failed" ], p [] [ text (ApiError.message error) ] ]

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
                        (List.map (searchMatchView config.selectedFile) results.matches)
                    ]
                ]

        NotAsked ->
            text ""


searchMatchView : (String -> msg) -> SearchMatch -> Html msg
searchMatchView selectedFile match =
    button [ type_ "button", class "repository-search-match", onClick (selectedFile match.path) ]
        [ span [ class "repository-match-heading" ]
            [ strong [] [ text match.path ], code [] [ text (":" ++ String.fromInt match.line) ] ]
        , pre []
            [ code []
                [ text
                    (String.join "\n"
                        (match.contextBefore ++ [ match.lineContent ] ++ match.contextAfter)
                    )
                ]
            ]
        ]


statusMark : String -> String
statusMark status =
    if status == "clean" || status == "" then
        "·"

    else
        String.left 1 status


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
            "Matching a regular expression with ripgrep."

        LiteralSearch ->
            "Matching literal text with ripgrep."
