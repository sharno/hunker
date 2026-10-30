module Hunker.Review.FileIndex exposing
    ( File
    , FileIndex
    , analysis
    , change
    , changes
    , clearAnalysis
    , files
    , fromChanges
    , get
    , moveAt
    , prepared
    , withAnalysis
    )

import Dict exposing (Dict)
import Hunker.Domain.Review exposing (AnalysisFeature(..), AnalysisFile, AnalysisSnapshot, FileChange, MovedBlock)
import Hunker.PreparedDiff as PreparedDiff exposing (PreparedFile)
import Hunker.Review.MoveIndex as MoveIndex exposing (FileMoves)
import Hunker.SemanticMove exposing (Endpoint)


{-| The ordered files in a review and their prepared patches are one value.

The ordered list is the source of truth; the path lookup is rebuilt from it
on every change, so rendered order and lookup cannot drift apart.

-}
type FileIndex
    = FileIndex
        { ordered : List File
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
    fromFiles
        (List.map
            (\fileChange ->
                File
                    { prepared = PreparedDiff.prepare fileChange
                    , analysis = Nothing
                    , moves = MoveIndex.emptyFile
                    }
            )
            orderedChanges
        )


fromFiles : List File -> FileIndex
fromFiles ordered =
    FileIndex
        { ordered = ordered
        , byPath = Dict.fromList (List.map (\file -> ( (change file).path, file )) ordered)
        }


mapFiles : (File -> File) -> FileIndex -> FileIndex
mapFiles transform (FileIndex index) =
    fromFiles (List.map transform index.ordered)


files : FileIndex -> List File
files (FileIndex index) =
    index.ordered


changes : FileIndex -> List FileChange
changes =
    files >> List.map change


get : String -> FileIndex -> Maybe File
get path (FileIndex index) =
    Dict.get path index.byPath


prepared : File -> PreparedFile
prepared (File file) =
    file.prepared


change : File -> FileChange
change =
    prepared >> .change


{-| Present only while a completed analysis snapshot decorates the file.
-}
analysis : File -> Maybe AnalysisFile
analysis (File file) =
    file.analysis


moveAt : Endpoint -> Int -> File -> Maybe MovedBlock
moveAt endpoint line (File file) =
    MoveIndex.get endpoint line file.moves


clearAnalysis : FileIndex -> FileIndex
clearAnalysis =
    mapFiles
        (\(File file) ->
            File
                { file
                    | prepared = PreparedDiff.clearWordRanges file.prepared
                    , analysis = Nothing
                    , moves = MoveIndex.emptyFile
                }
        )


withAnalysis : AnalysisSnapshot -> FileIndex -> FileIndex
withAnalysis snapshot =
    let
        moves =
            MoveIndex.fromList snapshot.moves
    in
    mapFiles
        (\(File file) ->
            let
                path =
                    file.prepared.change.path

                analyzed =
                    Dict.get path snapshot.files
            in
            File
                { file
                    | prepared =
                        case Maybe.map .wordDiff analyzed of
                            Just (FeatureComplete rows) ->
                                PreparedDiff.withWordDiff rows file.prepared

                            Just FeatureDisabled ->
                                file.prepared

                            Just (FeatureSkipped _) ->
                                file.prepared

                            Nothing ->
                                file.prepared
                    , analysis = analyzed
                    , moves = MoveIndex.file path moves
                }
        )
