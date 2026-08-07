module Hunker.SemanticMove exposing (Endpoint(..), anchor, containsLine, tone)

import Bitwise
import Hunker.Domain.Review exposing (MovedBlock)


type Endpoint
    = Source
    | Destination


anchor : MovedBlock -> Endpoint -> String
anchor move endpoint =
    "semantic-move-"
        ++ base36 (stableHash (key move))
        ++ "-"
        ++ (case endpoint of
                Source ->
                    "source"

                Destination ->
                    "destination"
           )


tone : MovedBlock -> Int
tone move =
    modBy 3 (stableHash (key move))


containsLine : String -> Int -> Endpoint -> MovedBlock -> Bool
containsLine path line endpoint move =
    case endpoint of
        Source ->
            path
                == move.fromPath
                && line
                >= move.fromLine
                && line
                < move.fromLine
                + move.fromLineCount

        Destination ->
            path
                == move.toPath
                && line
                >= move.toLine
                && line
                < move.toLine
                + move.toLineCount


key : MovedBlock -> String
key move =
    move.fromPath
        ++ ":"
        ++ String.fromInt move.fromLine
        ++ "->"
        ++ move.toPath
        ++ ":"
        ++ String.fromInt move.toLine
        ++ ":"
        ++ move.kind
        ++ ":"
        ++ move.label


stableHash : String -> Int
stableHash value =
    value
        |> String.toList
        |> List.foldl
            (\character hash ->
                fnvMultiply (Bitwise.xor hash (Char.toCode character))
            )
            2166136261


fnvMultiply : Int -> Int
fnvMultiply value =
    [ value
    , Bitwise.shiftLeftBy 1 value
    , Bitwise.shiftLeftBy 4 value
    , Bitwise.shiftLeftBy 7 value
    , Bitwise.shiftLeftBy 8 value
    , Bitwise.shiftLeftBy 24 value
    ]
        |> List.sum
        |> Bitwise.shiftRightZfBy 0


base36 : Int -> String
base36 value =
    if value < 36 then
        digit value

    else
        base36 (value // 36) ++ digit (modBy 36 value)


digit : Int -> String
digit value =
    if value < 10 then
        String.fromInt value

    else
        Char.fromCode (Char.toCode 'a' + value - 10)
            |> String.fromChar
