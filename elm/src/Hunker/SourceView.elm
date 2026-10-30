module Hunker.SourceView exposing (FileConfig, Range, file, line)

import Html exposing (Html, button, span, text)
import Html.Attributes exposing (attribute, class, type_)
import Html.Events exposing (onClick)
import Hunker.Domain.Settings exposing (Feature(..))
import Hunker.Domain.Source as Source exposing (FoldRegion, Presentation(..))


type alias Range =
    { start : Int
    , end : Int
    }


type alias FileConfig msg =
    { syntax : Feature
    , namespace : String
    , presentation : Presentation
    , isCollapsed : String -> Bool
    , toggleFold : String -> msg
    }


file : FileConfig msg -> String -> List (Html msg)
file config source =
    String.lines source
        |> List.indexedMap (\index sourceLine -> ( index + 1, sourceLine ))
        |> List.filter (\( number, _ ) -> not (hiddenLine config number))
        |> List.map (\( number, sourceLine ) -> sourceLineView config number sourceLine)


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
            (line config.syntax config.presentation number sourceLine []
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


{-| One source line with Rust-provided syntax spans and inline-change
overlays composed as independent layers.
-}
line : Feature -> Presentation -> Int -> String -> List Range -> List (Html msg)
line syntax presentation lineNumber source overlays =
    let
        highlights =
            case syntax of
                Enabled ->
                    Source.highlightsAt lineNumber presentation

                Disabled ->
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
    List.foldr
        (\value kept ->
            case kept of
                first :: _ ->
                    if first == value then
                        kept

                    else
                        value :: kept

                [] ->
                    [ value ]
        )
        []
        values


pairs : List value -> List ( value, value )
pairs values =
    List.map2 Tuple.pair values (List.drop 1 values)
