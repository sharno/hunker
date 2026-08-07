module Hunker.Diff exposing
    ( DiffLine
    , Hunk
    , Kind(..)
    , SideLine
    , SplitRow
    , fullFileRows
    , fullFileRowsPrepared
    , parsePatch
    , splitRows
    )


type Kind
    = Context
    | Addition
    | Deletion


type alias DiffLine =
    { kind : Kind
    , text : String
    , oldLine : Maybe Int
    , newLine : Maybe Int
    }


type alias Hunk =
    { id : String
    , header : String
    , oldStart : Int
    , oldCount : Int
    , newStart : Int
    , newCount : Int
    , lines : List DiffLine
    }


type alias SideLine =
    { number : Maybe Int
    , text : String
    , kind : Kind
    }


type alias SplitRow =
    { left : Maybe SideLine
    , right : Maybe SideLine
    }


type alias Builder =
    { id : String
    , header : String
    , oldStart : Int
    , oldCount : Int
    , newStart : Int
    , newCount : Int
    , oldLine : Int
    , newLine : Int
    , lines : List DiffLine
    }


parsePatch : String -> List Hunk
parsePatch patch =
    let
        step raw ( completed, current ) =
            if String.startsWith "@@" raw then
                let
                    ranges =
                        hunkRanges raw

                    finished =
                        Maybe.map finish current
                in
                ( maybeCons finished completed
                , Just
                    { id = String.fromInt ranges.oldStart ++ "-" ++ String.fromInt ranges.newStart
                    , header = raw
                    , oldStart = ranges.oldStart
                    , oldCount = ranges.oldCount
                    , newStart = ranges.newStart
                    , newCount = ranges.newCount
                    , oldLine = ranges.oldStart
                    , newLine = ranges.newStart
                    , lines = []
                    }
                )

            else
                case current of
                    Nothing ->
                        ( completed, Nothing )

                    Just builder ->
                        ( completed, Just (appendLine raw builder) )

        ( reverseHunks, finalBuilder ) =
            List.foldl step ( [], Nothing ) (String.lines patch)
    in
    List.reverse (maybeCons (Maybe.map finish finalBuilder) reverseHunks)


finish : Builder -> Hunk
finish builder =
    { id = builder.id
    , header = builder.header
    , oldStart = builder.oldStart
    , oldCount = builder.oldCount
    , newStart = builder.newStart
    , newCount = builder.newCount
    , lines = List.reverse builder.lines
    }


appendLine : String -> Builder -> Builder
appendLine raw builder =
    if String.startsWith "\\ No newline" raw then
        builder

    else
        case String.uncons raw of
            Nothing ->
                appendContext "" builder

            Just ( marker, value ) ->
                case marker of
                    '+' ->
                        { builder
                            | newLine = builder.newLine + 1
                            , lines =
                                { kind = Addition
                                , text = value
                                , oldLine = Nothing
                                , newLine = Just builder.newLine
                                }
                                    :: builder.lines
                        }

                    '-' ->
                        { builder
                            | oldLine = builder.oldLine + 1
                            , lines =
                                { kind = Deletion
                                , text = value
                                , oldLine = Just builder.oldLine
                                , newLine = Nothing
                                }
                                    :: builder.lines
                        }

                    ' ' ->
                        appendContext value builder

                    _ ->
                        appendContext raw builder


appendContext : String -> Builder -> Builder
appendContext value builder =
    { builder
        | oldLine = builder.oldLine + 1
        , newLine = builder.newLine + 1
        , lines =
            { kind = Context
            , text = value
            , oldLine = Just builder.oldLine
            , newLine = Just builder.newLine
            }
                :: builder.lines
    }


type alias HunkRanges =
    { oldStart : Int
    , oldCount : Int
    , newStart : Int
    , newCount : Int
    }


hunkRanges : String -> HunkRanges
hunkRanges header =
    case String.words header of
        "@@" :: oldRange :: newRange :: _ ->
            let
                ( oldStart, oldCount ) =
                    range '-' oldRange

                ( newStart, newCount ) =
                    range '+' newRange
            in
            { oldStart = oldStart
            , oldCount = oldCount
            , newStart = newStart
            , newCount = newCount
            }

        _ ->
            { oldStart = 0, oldCount = 0, newStart = 0, newCount = 0 }


range : Char -> String -> ( Int, Int )
range marker value =
    let
        parts =
            value
                |> String.trimLeft
                |> String.dropLeft
                    (if String.startsWith (String.fromChar marker) value then
                        1

                     else
                        0
                    )
                |> String.split ","
    in
    case parts of
        start :: count :: _ ->
            ( Maybe.withDefault 0 (String.toInt start)
            , Maybe.withDefault 1 (String.toInt count)
            )

        [ start ] ->
            ( Maybe.withDefault 0 (String.toInt start), 1 )

        _ ->
            ( 0, 0 )


splitRows : Bool -> Hunk -> List SplitRow
splitRows ignoreWhitespace hunk =
    rows hunk.lines
        |> List.filter
            (\row ->
                if ignoreWhitespace then
                    case ( row.left, row.right ) of
                        ( Just left, Just right ) ->
                            not
                                (left.kind
                                    == Deletion
                                    && right.kind
                                    == Addition
                                    && normalizeWhitespace left.text
                                    == normalizeWhitespace right.text
                                )

                        _ ->
                            True

                else
                    True
            )


rows : List DiffLine -> List SplitRow
rows lines =
    case lines of
        [] ->
            []

        first :: rest ->
            case first.kind of
                Context ->
                    { left = Just (leftLine first), right = Just (rightLine first) } :: rows rest

                Addition ->
                    { left = Nothing, right = Just (rightLine first) } :: rows rest

                Deletion ->
                    let
                        ( deletions, afterDeletions ) =
                            takeKind Deletion lines

                        ( additions, remaining ) =
                            takeKind Addition afterDeletions
                    in
                    zipChanges deletions additions ++ rows remaining


takeKind : Kind -> List DiffLine -> ( List DiffLine, List DiffLine )
takeKind kind lines =
    case lines of
        first :: rest ->
            if first.kind == kind then
                let
                    ( matches, remaining ) =
                        takeKind kind rest
                in
                ( first :: matches, remaining )

            else
                ( [], lines )

        [] ->
            ( [], [] )


zipChanges : List DiffLine -> List DiffLine -> List SplitRow
zipChanges oldLines newLines =
    case ( oldLines, newLines ) of
        ( [], [] ) ->
            []

        ( old :: restOld, new :: restNew ) ->
            { left = Just (leftLine old), right = Just (rightLine new) }
                :: zipChanges restOld restNew

        ( old :: restOld, [] ) ->
            { left = Just (leftLine old), right = Nothing }
                :: zipChanges restOld []

        ( [], new :: restNew ) ->
            { left = Nothing, right = Just (rightLine new) }
                :: zipChanges [] restNew


leftLine : DiffLine -> SideLine
leftLine line =
    { number = line.oldLine, text = line.text, kind = line.kind }


rightLine : DiffLine -> SideLine
rightLine line =
    { number = line.newLine, text = line.text, kind = line.kind }


fullFileRows : String -> String -> String -> List SplitRow
fullFileRows patch oldText newText =
    fullFileRowsPrepared (parsePatch patch) oldText newText


fullFileRowsPrepared : List Hunk -> String -> String -> List SplitRow
fullFileRowsPrepared hunks oldText newText =
    stitchFullFile
        (String.lines oldText)
        (String.lines newText)
        1
        1
        hunks


stitchFullFile : List String -> List String -> Int -> Int -> List Hunk -> List SplitRow
stitchFullFile oldLines newLines oldPosition newPosition hunks =
    case hunks of
        [] ->
            zipFull oldPosition
                newPosition
                (List.drop (oldPosition - 1) oldLines)
                (List.drop (newPosition - 1) newLines)

        hunk :: remaining ->
            let
                oldContext =
                    oldLines
                        |> List.drop (oldPosition - 1)
                        |> List.take (max 0 (hunk.oldStart - oldPosition + zeroRangeOffset hunk.oldCount))

                newContext =
                    newLines
                        |> List.drop (newPosition - 1)
                        |> List.take (max 0 (hunk.newStart - newPosition + zeroRangeOffset hunk.newCount))

                nextOld =
                    hunk.oldStart + max 1 hunk.oldCount

                nextNew =
                    hunk.newStart + max 1 hunk.newCount
            in
            zipFull oldPosition newPosition oldContext newContext
                ++ splitRows False hunk
                ++ stitchFullFile oldLines newLines nextOld nextNew remaining


zeroRangeOffset : Int -> Int
zeroRangeOffset count =
    if count == 0 then
        1

    else
        0


zipFull : Int -> Int -> List String -> List String -> List SplitRow
zipFull oldLineNumber newLineNumber oldLines newLines =
    case ( oldLines, newLines ) of
        ( [], [] ) ->
            []

        ( old :: remainingOld, new :: remainingNew ) ->
            { left = Just { number = Just oldLineNumber, text = old, kind = Context }
            , right = Just { number = Just newLineNumber, text = new, kind = Context }
            }
                :: zipFull (oldLineNumber + 1) (newLineNumber + 1) remainingOld remainingNew

        ( old :: remainingOld, [] ) ->
            { left = Just { number = Just oldLineNumber, text = old, kind = Deletion }, right = Nothing }
                :: zipFull (oldLineNumber + 1) newLineNumber remainingOld []

        ( [], new :: remainingNew ) ->
            { left = Nothing, right = Just { number = Just newLineNumber, text = new, kind = Addition } }
                :: zipFull oldLineNumber (newLineNumber + 1) [] remainingNew


normalizeWhitespace : String -> String
normalizeWhitespace =
    String.words >> String.join " "


maybeCons : Maybe value -> List value -> List value
maybeCons maybeValue values =
    case maybeValue of
        Just value ->
            value :: values

        Nothing ->
            values
