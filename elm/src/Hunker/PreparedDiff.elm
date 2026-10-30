module Hunker.PreparedDiff exposing
    ( PreparedFile
    , clearWordRanges
    , prepare
    , rangesFor
    , withWordDiff
    )

import Dict exposing (Dict)
import Hunker.Diff as Diff exposing (Hunk, Side(..))
import Hunker.Domain.Review exposing (CharacterRange, CharacterRow, FileChange)


type alias PreparedFile =
    { change : FileChange
    , hunks : List Hunk
    , searchText : String
    , oldRanges : Dict Int (List CharacterRange)
    , newRanges : Dict Int (List CharacterRange)
    }


prepare : FileChange -> PreparedFile
prepare change =
    { change = change
    , hunks = Diff.parsePatch change.patch
    , searchText = String.toLower (change.path ++ "\n" ++ change.patch)
    , oldRanges = Dict.empty
    , newRanges = Dict.empty
    }


clearWordRanges : PreparedFile -> PreparedFile
clearWordRanges prepared =
    { prepared | oldRanges = Dict.empty, newRanges = Dict.empty }


withWordDiff : List CharacterRow -> PreparedFile -> PreparedFile
withWordDiff rows prepared =
    let
        add row indexes =
            { old = insertRanges row.oldLine row.oldRanges indexes.old
            , new = insertRanges row.newLine row.newRanges indexes.new
            }

        indexed =
            List.foldl add { old = Dict.empty, new = Dict.empty } rows
    in
    { prepared | oldRanges = indexed.old, newRanges = indexed.new }


{-| Word-diff ranges for one line. A line without changed words has none.
-}
rangesFor : Side -> Int -> PreparedFile -> List CharacterRange
rangesFor side line prepared =
    Dict.get line
        (case side of
            OldSide ->
                prepared.oldRanges

            NewSide ->
                prepared.newRanges
        )
        |> Maybe.withDefault []


insertRanges : Maybe Int -> List CharacterRange -> Dict Int (List CharacterRange) -> Dict Int (List CharacterRange)
insertRanges line ranges indexes =
    case line of
        Just number ->
            Dict.insert number ranges indexes

        Nothing ->
            indexes
