module Hunker.SourceView exposing (FileConfig, Range, file, line)

import Html exposing (Html, button, span, text)
import Html.Attributes exposing (attribute, class, type_)
import Html.Events exposing (onClick)
import Hunker.Domain.Source as Source exposing (FoldRegion, Presentation(..))
import Hunker.Syntax as FallbackSyntax


type alias Range =
    { start : Int
    , end : Int
    }


type alias FileConfig msg =
    { syntax : Bool
    , namespace : String
    , path : String
    , presentation : Presentation
    , isCollapsed : String -> Bool
    , toggleFold : String -> msg
    }


file : FileConfig msg -> String -> List (Html msg)
file config source =
    renderLines config 1 (String.lines source)


renderLines : FileConfig msg -> Int -> List String -> List (Html msg)
renderLines config number remaining =
    case remaining of
        [] ->
            []

        sourceLine :: rest ->
            if hiddenLine config number then
                renderLines config (number + 1) rest

            else
                sourceLineView config number sourceLine
                    :: renderLines config (number + 1) rest


sourceLineView : FileConfig msg -> Int -> String -> Html msg
sourceLineView config number sourceLine =
    let
        fold =
            foldAt config.presentation number

        collapsed =
            fold
                |> Maybe.map (Source.foldKey config.namespace >> config.isCollapsed)
                |> Maybe.withDefault False
    in
    span [ class ("source-line" ++ boolClass collapsed " is-folded") ]
        [ span [ class "line-number" ]
            [ case fold of
                Just region ->
                    button
                        [ type_ "button"
                        , class "source-fold-toggle"
                        , attribute "title" (foldTitle collapsed region)
                        , onClick (config.toggleFold (Source.foldKey config.namespace region))
                        ]
                        [ text
                            (if collapsed then
                                "›"

                             else
                                "⌄"
                            )
                        ]

                Nothing ->
                    span [ class "source-fold-spacer" ] []
            , text (String.fromInt number)
            ]
        , span [ class "line-code" ]
            (line config.syntax config.path config.presentation number sourceLine []
                ++ (if collapsed then
                        [ span [ class "source-fold-summary" ]
                            [ text
                                (fold
                                    |> Maybe.map
                                        (\region ->
                                            " … "
                                                ++ String.fromInt (region.endLine - region.startLine)
                                                ++ " lines"
                                        )
                                    |> Maybe.withDefault ""
                                )
                            ]
                        ]

                    else
                        []
                   )
            )
        ]


line : Bool -> String -> Presentation -> Int -> String -> List Range -> List (Html msg)
line syntax path presentation lineNumber source overlays =
    case presentation of
        Unsupported _ ->
            if List.isEmpty overlays then
                FallbackSyntax.line syntax path source

            else
                segmentedLine False presentation lineNumber source overlays

        Complete _ ->
            segmentedLine syntax presentation lineNumber source overlays


segmentedLine : Bool -> Presentation -> Int -> String -> List Range -> List (Html msg)
segmentedLine syntax presentation lineNumber source overlays =
    let
        highlights =
            if syntax then
                Source.highlightsAt lineNumber presentation

            else
                []

        sourceLength =
            String.length source

        boundaries =
            0
                :: sourceLength
                :: (List.concatMap (\range -> [ clamp 0 sourceLength range.start, clamp 0 sourceLength range.end ]) overlays
                        ++ List.concatMap (\range -> [ clamp 0 sourceLength range.start, clamp 0 sourceLength range.end ]) highlights
                   )
                |> List.sort
                |> unique
    in
    boundaries
        |> pairs
        |> List.filterMap
            (\( start, end ) ->
                if start >= end then
                    Nothing

                else
                    let
                        classes =
                            [ highlights
                                |> List.filter (contains start end)
                                |> List.reverse
                                |> List.head
                                |> Maybe.map (.kind >> Source.highlightClass)
                            , if List.any (contains start end) overlays then
                                Just "inline-change"

                              else
                                Nothing
                            ]
                                |> List.filterMap identity
                                |> String.join " "

                        content =
                            text (String.slice start end source)
                    in
                    if classes == "" then
                        Just content

                    else
                        Just (span [ class classes ] [ content ])
            )


contains : Int -> Int -> { range | start : Int, end : Int } -> Bool
contains start end range =
    range.start <= start && range.end >= end


hiddenLine : FileConfig msg -> Int -> Bool
hiddenLine config number =
    Source.isLineHidden config.isCollapsed config.namespace number config.presentation


foldAt : Presentation -> Int -> Maybe FoldRegion
foldAt presentation number =
    Source.foldAt number presentation


foldTitle : Bool -> FoldRegion -> String
foldTitle collapsed region =
    (if collapsed then
        "Expand "

     else
        "Collapse "
    )
        ++ region.label


boolClass : Bool -> String -> String
boolClass enabled value =
    if enabled then
        value

    else
        ""


unique : List comparable -> List comparable
unique values =
    case values of
        first :: second :: rest ->
            if first == second then
                unique (second :: rest)

            else
                first :: unique (second :: rest)

        _ ->
            values


pairs : List value -> List ( value, value )
pairs values =
    case values of
        first :: second :: rest ->
            ( first, second ) :: pairs (second :: rest)

        _ ->
            []
