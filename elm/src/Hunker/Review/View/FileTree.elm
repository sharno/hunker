module Hunker.Review.View.FileTree exposing (Config, view)

import Html exposing (Html, button, div, span, text)
import Html.Attributes exposing (attribute, class, type_)
import Html.Events exposing (onClick)
import Hunker.Domain.Review as Review exposing (FileChange)
import Hunker.FileTree exposing (Tree(..))


type alias Config msg =
    { selectedPath : String
    , isReviewed : String -> Bool
    , isCollapsed : String -> Bool
    , toggleFolder : String -> msg
    , selectFile : String -> msg
    , statusGlyph : Review.FileStatus -> String
    }


view : Config msg -> List (Tree FileChange) -> Html msg
view config forest =
    div [ class "file-tree" ] (List.map (node config 0) forest)


node : Config msg -> Int -> Tree FileChange -> Html msg
node config depth tree =
    case tree of
        Folder name path children ->
            let
                collapsed =
                    config.isCollapsed path
            in
            div [ class "file-tree-folder" ]
                [ button
                    [ type_ "button"
                    , class "folder-row"
                    , attribute "style" ("padding-left:" ++ String.fromInt (depth * 14 + 8) ++ "px")
                    , onClick (config.toggleFolder path)
                    ]
                    [ span [ class "folder-chevron" ]
                        [ text
                            (if collapsed then
                                "›"

                             else
                                "⌄"
                            )
                        ]
                    , span [ class "folder-icon" ] [ text "▰" ]
                    , span [] [ text name ]
                    , span [ class "tree-count" ] [ text (String.fromInt (fileCount tree)) ]
                    ]
                , if collapsed then
                    text ""

                  else
                    div [] (List.map (node config (depth + 1)) children)
                ]

        Leaf name file ->
            let
                reviewed =
                    config.isReviewed file.path
            in
            button
                [ type_ "button"
                , class ("file-row" ++ activeClass (file.path == config.selectedPath))
                , attribute "style" ("padding-left:" ++ String.fromInt (depth * 14 + 20) ++ "px")
                , onClick (config.selectFile file.path)
                ]
                [ span [ class ("file-status status-" ++ Review.fileStatusToString file.status) ]
                    [ text
                        (if reviewed then
                            "✓"

                         else
                            config.statusGlyph file.status
                        )
                    ]
                , span [ class "file-copy" ] [ span [ class "file-name" ] [ text name ] ]
                , span [ class "file-delta" ]
                    [ span [ class "plus" ] [ text ("+" ++ String.fromInt file.additions) ]
                    , span [ class "minus" ] [ text ("−" ++ String.fromInt file.deletions) ]
                    ]
                ]


fileCount : Tree value -> Int
fileCount tree =
    case tree of
        Leaf _ _ ->
            1

        Folder _ _ children ->
            List.sum (List.map fileCount children)


activeClass : Bool -> String
activeClass active =
    if active then
        " is-active"

    else
        ""
