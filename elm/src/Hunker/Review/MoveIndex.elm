module Hunker.Review.MoveIndex exposing (FileMoves, Index, emptyFile, file, fromList, get)

import Dict exposing (Dict)
import Hunker.Domain.Review exposing (MovedBlock)
import Hunker.SemanticMove exposing (Endpoint(..))


type Index
    = Index (Dict String FileMoves)


type FileMoves
    = FileMoves
        { sources : Dict Int MovedBlock
        , destinations : Dict Int MovedBlock
        }


emptyFile : FileMoves
emptyFile =
    FileMoves { sources = Dict.empty, destinations = Dict.empty }


fromList : List MovedBlock -> Index
fromList moves =
    moves
        |> List.foldl insertMove Dict.empty
        |> Index


file : String -> Index -> FileMoves
file path (Index indexed) =
    Dict.get path indexed |> Maybe.withDefault emptyFile


get : Endpoint -> Int -> FileMoves -> Maybe MovedBlock
get endpoint line (FileMoves indexed) =
    Dict.get line
        (case endpoint of
            Source ->
                indexed.sources

            Destination ->
                indexed.destinations
        )


insertMove : MovedBlock -> Dict String FileMoves -> Dict String FileMoves
insertMove move indexed =
    indexed
        |> insertRange move.fromPath Source move.fromLine move.fromLineCount move
        |> insertRange move.toPath Destination move.toLine move.toLineCount move


insertRange : String -> Endpoint -> Int -> Int -> MovedBlock -> Dict String FileMoves -> Dict String FileMoves
insertRange path endpoint start count move =
    Dict.update path
        (Maybe.withDefault emptyFile
            >> insertFileRange endpoint start count move
            >> Just
        )


insertFileRange : Endpoint -> Int -> Int -> MovedBlock -> FileMoves -> FileMoves
insertFileRange endpoint start count move (FileMoves indexed) =
    let
        insertLine line =
            Dict.update line
                (\current ->
                    case current of
                        Just existing ->
                            Just existing

                        Nothing ->
                            Just move
                )

        lines =
            List.range start (start + max 1 count - 1)
    in
    case endpoint of
        Source ->
            FileMoves { indexed | sources = List.foldl insertLine indexed.sources lines }

        Destination ->
            FileMoves { indexed | destinations = List.foldl insertLine indexed.destinations lines }
