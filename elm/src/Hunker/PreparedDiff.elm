module Hunker.PreparedDiff exposing
    ( PreparedFile
    , clearWordRanges
    , prepare
    , rangesFor
    , withWordDiff
    )

import Dict exposing (Dict)
import Hunker.Diff as Diff exposing (Hunk, Side(..))
import Hunker.Domain.Review exposing (CharacterRange, FileChange, LineWords, WordChanges)


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


withWordDiff : WordChanges -> PreparedFile -> PreparedFile
withWordDiff changes prepared =
    { prepared | oldRanges = byLine changes.old, newRanges = byLine changes.new }


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


byLine : List LineWords -> Dict Int (List CharacterRange)
byLine =
    List.map (\words -> ( words.line, words.ranges )) >> Dict.fromList
