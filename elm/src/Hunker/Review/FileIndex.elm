module Hunker.Review.FileIndex exposing
    ( File
    , FileIndex
    , analysis
    , change
    , changes
    , clearWordRanges
    , fromChanges
    , get
    , hunks
    , moveAt
    , prepared
    , withAnalysis
    )

import Dict exposing (Dict)
import Hunker.Diff exposing (Hunk)
import Hunker.Domain.Review exposing (AnalysisFile, AnalysisSnapshot, FileChange, MovedBlock)
import Hunker.PreparedDiff as PreparedDiff exposing (PreparedFile)
import Hunker.Review.MoveIndex as MoveIndex exposing (FileMoves)
import Hunker.SemanticMove exposing (Endpoint)


{-| The ordered files in a review and their prepared patches are one value.

Keeping the constructor private prevents the rendered order and path lookup from
drifting apart after a refresh or analysis result.

-}
type FileIndex
    = FileIndex
        { order : List String
        , byPath : Dict String File
        }


type File
    = File
        { prepared : PreparedFile
        , analysis : Maybe AnalysisFile
        , moves : FileMoves
        }


fromChanges : List FileChange -> FileIndex
fromChanges orderedChanges =
    FileIndex
        { order = List.map .path orderedChanges
        , byPath =
            orderedChanges
                |> List.map
                    (\fileChange ->
                        ( fileChange.path
                        , File
                            { prepared = PreparedDiff.prepare fileChange
                            , analysis = Nothing
                            , moves = MoveIndex.emptyFile
                            }
                        )
                    )
                |> Dict.fromList
        }


changes : FileIndex -> List FileChange
changes (FileIndex index) =
    List.filterMap
        (\path -> Dict.get path index.byPath |> Maybe.map change)
        index.order


get : String -> FileIndex -> Maybe File
get path (FileIndex index) =
    Dict.get path index.byPath


hunks : String -> FileIndex -> List Hunk
hunks path index =
    get path index
        |> Maybe.map (prepared >> .hunks)
        |> Maybe.withDefault []


prepared : File -> PreparedFile
prepared (File file) =
    file.prepared


change : File -> FileChange
change =
    prepared >> .change


analysis : File -> Maybe AnalysisFile
analysis (File file) =
    file.analysis


moveAt : Endpoint -> Int -> File -> Maybe MovedBlock
moveAt endpoint line (File file) =
    MoveIndex.get endpoint line file.moves


clearWordRanges : FileIndex -> FileIndex
clearWordRanges (FileIndex index) =
    FileIndex
        { index
            | byPath =
                Dict.map
                    (\_ (File file) ->
                        File
                            { file
                                | prepared = PreparedDiff.clearWordRanges file.prepared
                                , analysis = Nothing
                                , moves = MoveIndex.emptyFile
                            }
                    )
                    index.byPath
        }


withAnalysis : AnalysisSnapshot -> FileIndex -> FileIndex
withAnalysis snapshot (FileIndex index) =
    let
        moves =
            MoveIndex.fromList snapshot.moves

        apply path (File file) =
            let
                analyzed =
                    Dict.get path snapshot.files

                preparedFile =
                    analyzed
                        |> Maybe.andThen .wordDiff
                        |> Maybe.map (\wordDiff -> PreparedDiff.withWordDiff wordDiff file.prepared)
                        |> Maybe.withDefault file.prepared
            in
            File
                { file
                    | prepared = preparedFile
                    , analysis = analyzed
                    , moves = MoveIndex.file path moves
                }
    in
    FileIndex
        { index
            | byPath = Dict.map apply index.byPath
        }
