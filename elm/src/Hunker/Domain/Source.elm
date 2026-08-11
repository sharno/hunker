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
    , folds
    , highlightClass
    , highlightsAt
    , isLineHidden
    , unsupported
    )

import Json.Decode as Decode exposing (Decoder)


type Presentation
    = Unsupported String
    | Complete Details


type alias Details =
    { language : String
    , highlights : List HighlightSpan
    , folds : List FoldRegion
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
            List.filter (.line >> (==) line) details.highlights

        Unsupported _ ->
            []


folds : Presentation -> List FoldRegion
folds presentation =
    case presentation of
        Complete details ->
            details.folds

        Unsupported _ ->
            []


foldAt : Int -> Presentation -> Maybe FoldRegion
foldAt line presentation =
    folds presentation
        |> List.filter (.startLine >> (==) line)
        |> List.sortBy (\region -> region.startLine - region.endLine)
        |> List.head


foldKey : String -> FoldRegion -> String
foldKey namespace fold =
    namespace ++ "::" ++ fold.id


isLineHidden : (String -> Bool) -> String -> Int -> Presentation -> Bool
isLineHidden isCollapsed namespace line presentation =
    folds presentation
        |> List.any
            (\region ->
                isCollapsed (foldKey namespace region)
                    && line
                    > region.startLine
                    && line
                    <= region.endLine
            )


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
    Decode.map3 Details
        (Decode.field "language" Decode.string)
        (Decode.field "highlights" (Decode.list highlightDecoder))
        (Decode.field "folds" (Decode.list foldDecoder))


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
