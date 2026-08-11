module Hunker.Domain.Source exposing
    ( FilePresentation
    , FoldRegion
    , HighlightSpan
    , Presentation(..)
    , decoder
    , fileDecoder
    , fileNew
    , fileOld
    , filePresentation
    , foldAt
    , foldKey
    , highlightClass
    , highlightsAt
    , isLineHidden
    , unsupported
    )

import Dict exposing (Dict)
import Json.Decode as Decode exposing (Decoder)


type Presentation
    = Unsupported String
    | Complete Details


type alias Details =
    { highlightsByLine : Dict Int (List HighlightSpan)
    , foldsByStartLine : Dict Int (List FoldRegion)
    , foldsByCoveredLine : Dict Int (List FoldRegion)
    }


type alias HighlightSpan =
    { line : Int
    , start : Int
    , end : Int
    , kind : HighlightKind
    }


type HighlightKind
    = SyntaxAttribute
    | SyntaxComment
    | SyntaxConstant
    | SyntaxFunction
    | SyntaxKeyword
    | SyntaxModule
    | SyntaxNumber
    | SyntaxOperator
    | SyntaxProperty
    | SyntaxPunctuation
    | SyntaxString
    | SyntaxTag
    | SyntaxType
    | SyntaxVariable


type alias FoldRegion =
    { id : String
    , kind : FoldKind
    , label : String
    , startLine : Int
    , endLine : Int
    }


type FoldKind
    = FoldBlock
    | FoldClass
    | FoldFunction
    | FoldImplementation
    | FoldInterface
    | FoldModule
    | FoldTrait
    | FoldType


type FilePresentation
    = FilePresentation
        { old : Presentation
        , new : Presentation
        }


unsupported : Presentation
unsupported =
    Unsupported "Syntax highlighting is unavailable for this language."


fileOld : FilePresentation -> Presentation
fileOld (FilePresentation details) =
    details.old


fileNew : FilePresentation -> Presentation
fileNew (FilePresentation details) =
    details.new


filePresentation : Presentation -> Presentation -> FilePresentation
filePresentation old new =
    FilePresentation { old = old, new = new }


highlightsAt : Int -> Presentation -> List HighlightSpan
highlightsAt line presentation =
    case presentation of
        Complete details ->
            Dict.get line details.highlightsByLine
                |> Maybe.withDefault []

        Unsupported _ ->
            []


foldAt : Int -> Presentation -> Maybe FoldRegion
foldAt line presentation =
    case presentation of
        Complete details ->
            details.foldsByStartLine
                |> Dict.get line
                |> Maybe.withDefault []
                |> List.sortBy (\region -> region.startLine - region.endLine)
                |> List.head

        Unsupported _ ->
            Nothing


foldKey : String -> FoldRegion -> String
foldKey namespace fold =
    namespace ++ "::" ++ fold.id


isLineHidden : (String -> Bool) -> String -> Int -> Presentation -> Bool
isLineHidden isCollapsed namespace line presentation =
    case presentation of
        Complete details ->
            details.foldsByCoveredLine
                |> Dict.get line
                |> Maybe.withDefault []
                |> List.any (foldKey namespace >> isCollapsed)

        Unsupported _ ->
            False


highlightClass : HighlightKind -> String
highlightClass kind =
    case kind of
        SyntaxAttribute ->
            "syntax-attribute"

        SyntaxComment ->
            "syntax-comment"

        SyntaxConstant ->
            "syntax-constant"

        SyntaxFunction ->
            "syntax-function"

        SyntaxKeyword ->
            "syntax-keyword"

        SyntaxModule ->
            "syntax-module"

        SyntaxNumber ->
            "syntax-number"

        SyntaxOperator ->
            "syntax-operator"

        SyntaxProperty ->
            "syntax-property"

        SyntaxPunctuation ->
            "syntax-punctuation"

        SyntaxString ->
            "syntax-string"

        SyntaxTag ->
            "syntax-tag"

        SyntaxType ->
            "syntax-type"

        SyntaxVariable ->
            "syntax-variable"


decoder : Decoder Presentation
decoder =
    Decode.field "_tag" Decode.string
        |> Decode.andThen
            (\tag ->
                case tag of
                    "Unsupported" ->
                        Decode.map Unsupported (Decode.field "reason" Decode.string)

                    "Complete" ->
                        Decode.map Complete (Decode.field "value" detailsDecoder)

                    _ ->
                        Decode.fail ("Unknown source presentation: " ++ tag)
            )


detailsDecoder : Decoder Details
detailsDecoder =
    Decode.map3 prepareDetails
        (Decode.field "language" Decode.string)
        (Decode.field "highlights" (Decode.list highlightDecoder))
        (Decode.field "folds" (Decode.list foldDecoder))


prepareDetails : String -> List HighlightSpan -> List FoldRegion -> Details
prepareDetails _ highlights folds_ =
    { highlightsByLine = indexHighlights highlights
    , foldsByStartLine = indexFoldStarts folds_
    , foldsByCoveredLine = indexFoldCoverage folds_
    }


indexHighlights : List HighlightSpan -> Dict Int (List HighlightSpan)
indexHighlights =
    List.foldr
        (\highlight -> Dict.update highlight.line (Maybe.withDefault [] >> (::) highlight >> Just))
        Dict.empty


indexFoldStarts : List FoldRegion -> Dict Int (List FoldRegion)
indexFoldStarts =
    List.foldr
        (\fold -> Dict.update fold.startLine (Maybe.withDefault [] >> (::) fold >> Just))
        Dict.empty


indexFoldCoverage : List FoldRegion -> Dict Int (List FoldRegion)
indexFoldCoverage =
    List.foldl
        (\fold indexed ->
            List.range (fold.startLine + 1) fold.endLine
                |> List.foldl
                    (\line -> Dict.update line (Maybe.withDefault [] >> (::) fold >> Just))
                    indexed
        )
        Dict.empty


highlightDecoder : Decoder HighlightSpan
highlightDecoder =
    Decode.map4 HighlightSpan
        (Decode.field "line" Decode.int)
        (Decode.field "startCharacter" Decode.int)
        (Decode.field "endCharacter" Decode.int)
        (Decode.field "kind" highlightKindDecoder)


highlightKindDecoder : Decoder HighlightKind
highlightKindDecoder =
    Decode.string
        |> Decode.andThen
            (\value ->
                case value of
                    "attribute" ->
                        Decode.succeed SyntaxAttribute

                    "comment" ->
                        Decode.succeed SyntaxComment

                    "constant" ->
                        Decode.succeed SyntaxConstant

                    "function" ->
                        Decode.succeed SyntaxFunction

                    "keyword" ->
                        Decode.succeed SyntaxKeyword

                    "module" ->
                        Decode.succeed SyntaxModule

                    "number" ->
                        Decode.succeed SyntaxNumber

                    "operator" ->
                        Decode.succeed SyntaxOperator

                    "property" ->
                        Decode.succeed SyntaxProperty

                    "punctuation" ->
                        Decode.succeed SyntaxPunctuation

                    "string" ->
                        Decode.succeed SyntaxString

                    "tag" ->
                        Decode.succeed SyntaxTag

                    "type" ->
                        Decode.succeed SyntaxType

                    "variable" ->
                        Decode.succeed SyntaxVariable

                    _ ->
                        Decode.fail ("Unknown syntax highlight kind: " ++ value)
            )


foldDecoder : Decoder FoldRegion
foldDecoder =
    Decode.map5 FoldRegion
        (Decode.field "id" Decode.string)
        (Decode.field "kind" foldKindDecoder)
        (Decode.field "label" Decode.string)
        (Decode.field "startLine" Decode.int)
        (Decode.field "endLine" Decode.int)


foldKindDecoder : Decoder FoldKind
foldKindDecoder =
    Decode.string
        |> Decode.andThen
            (\value ->
                case value of
                    "block" ->
                        Decode.succeed FoldBlock

                    "class" ->
                        Decode.succeed FoldClass

                    "function" ->
                        Decode.succeed FoldFunction

                    "implementation" ->
                        Decode.succeed FoldImplementation

                    "interface" ->
                        Decode.succeed FoldInterface

                    "module" ->
                        Decode.succeed FoldModule

                    "trait" ->
                        Decode.succeed FoldTrait

                    "type" ->
                        Decode.succeed FoldType

                    _ ->
                        Decode.fail ("Unknown source fold kind: " ++ value)
            )


fileDecoder : Decoder FilePresentation
fileDecoder =
    Decode.map2
        filePresentation
        (Decode.field "old" decoder)
        (Decode.field "new" decoder)
