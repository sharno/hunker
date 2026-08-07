module Hunker.Review.FileIndex exposing
    ( FileIndex
    , changes
    , clearWordRanges
    , fromChanges
    , get
    , hunks
    , withAnalysis
    )

import Dict exposing (Dict)
import Hunker.Diff exposing (Hunk)
import Hunker.Domain.Review exposing (AnalysisSnapshot, FileChange)
import Hunker.PreparedDiff as PreparedDiff exposing (PreparedFile)


{-| The ordered files in a review and their prepared patches are one value.

Keeping the constructor private prevents the rendered order and path lookup from
drifting apart after a refresh or analysis result.

-}
type FileIndex
    = FileIndex
        { order : List String
        , byPath : Dict String PreparedFile
        }


fromChanges : List FileChange -> FileIndex
fromChanges orderedChanges =
    FileIndex
        { order = List.map .path orderedChanges
        , byPath =
            orderedChanges
                |> List.map (\change -> ( change.path, PreparedDiff.prepare change ))
                |> Dict.fromList
        }


changes : FileIndex -> List FileChange
changes (FileIndex index) =
    List.filterMap
        (\path -> Dict.get path index.byPath |> Maybe.map .change)
        index.order


get : String -> FileIndex -> Maybe PreparedFile
get path (FileIndex index) =
    Dict.get path index.byPath


hunks : String -> FileIndex -> List Hunk
hunks path index =
    get path index
        |> Maybe.map .hunks
        |> Maybe.withDefault []


clearWordRanges : FileIndex -> FileIndex
clearWordRanges (FileIndex index) =
    FileIndex { index | byPath = Dict.map (\_ -> PreparedDiff.clearWordRanges) index.byPath }


withAnalysis : AnalysisSnapshot -> FileIndex -> FileIndex
withAnalysis snapshot (FileIndex index) =
    let
        apply _ analyzed prepared =
            case ( Dict.get analyzed.path prepared, analyzed.wordDiff ) of
                ( Just existing, Just wordDiff ) ->
                    Dict.insert analyzed.path (PreparedDiff.withWordDiff wordDiff existing) prepared

                _ ->
                    prepared
    in
    FileIndex
        { index
            | byPath = Dict.foldl apply index.byPath snapshot.files
        }
