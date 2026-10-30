module Hunker.Diff exposing
    ( DiffLine(..)
    , Hunk
    , Kind(..)
    , Side(..)
    , SideLine
    , SplitRow
    , fullFileRows
    , lastAnchor
    , lineAnchor
    , lineKind
    , lineText
    , parsePatch
    , splitRows
    , unifiedLines
    )

{-| Hunks parsed from one file's patch. Rust owns file boundaries; this
module only splits a single file's hunks into typed lines.

Every list transformation here is a fold, so 10k-line files stay within the
JavaScript stack.

-}


type Kind
    = Context
    | Addition
    | Deletion


type Side
    = OldSide
    | NewSide


{-| A patch line. Each constructor carries exactly the line numbers it has.
-}
type DiffLine
    = ContextLine { old : Int, new : Int, text : String }
    | AddedLine { new : Int, text : String }
    | RemovedLine { old : Int, text : String }


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
    { number : Int
    , text : String
    , kind : Kind
    }


type alias SplitRow =
    { left : Maybe SideLine
    , right : Maybe SideLine
    }


lineKind : DiffLine -> Kind
lineKind line =
    case line of
        ContextLine _ ->
            Context

        AddedLine _ ->
            Addition

        RemovedLine _ ->
            Deletion


lineText : DiffLine -> String
lineText line =
    case line of
        ContextLine context ->
            context.text

        AddedLine added ->
            added.text

        RemovedLine removed ->
            removed.text


{-| Where a line can be anchored: removed lines on the old side, everything
else on the new side.
-}
lineAnchor : DiffLine -> ( Side, Int )
lineAnchor line =
    case line of
        ContextLine context ->
            ( NewSide, context.new )

        AddedLine added ->
            ( NewSide, added.new )

        RemovedLine removed ->
            ( OldSide, removed.old )


{-| The last real patch line, preferring the new side, as GitHub requires
review comments to sit on a line of the diff.
-}
lastAnchor : List Hunk -> Maybe ( Side, Int )
lastAnchor hunks =
    let
        lines =
            List.concatMap .lines hunks |> List.reverse

        newSide =
            lines
                |> List.filterMap
                    (\line ->
                        case lineAnchor line of
                            ( NewSide, number ) ->
                                Just ( NewSide, number )

                            ( OldSide, _ ) ->
                                Nothing
                    )
                |> List.head
    in
    case newSide of
        Just anchor ->
            Just anchor

        Nothing ->
            List.head lines |> Maybe.map lineAnchor


type alias Builder =
    { header : HunkHeader
    , raw : String
    , oldLine : Int
    , newLine : Int
    , lines : List DiffLine
    }


type alias HunkHeader =
    { oldStart : Int
    , oldCount : Int
    , newStart : Int
    , newCount : Int
    }


parsePatch : String -> List Hunk
parsePatch patch =
    let
        step raw ( completed, current ) =
            case ( hunkHeader raw, current ) of
                ( Just header, _ ) ->
                    ( maybeCons (Maybe.map finish current) completed
                    , Just { header = header, raw = raw, oldLine = header.oldStart, newLine = header.newStart, lines = [] }
                    )

                ( Nothing, Just builder ) ->
                    ( completed, Just (appendLine raw builder) )

                ( Nothing, Nothing ) ->
                    ( completed, Nothing )

        ( reverseHunks, finalBuilder ) =
            List.foldl step ( [], Nothing ) (patchLines patch)
    in
    List.reverse (maybeCons (Maybe.map finish finalBuilder) reverseHunks)


{-| A trailing newline is a terminator, not an empty context line.
-}
patchLines : String -> List String
patchLines patch =
    if String.endsWith "\n" patch then
        String.lines (String.dropRight 1 patch)

    else
        String.lines patch


finish : Builder -> Hunk
finish builder =
    { id = String.fromInt builder.header.oldStart ++ "-" ++ String.fromInt builder.header.newStart
    , header = builder.raw
    , oldStart = builder.header.oldStart
    , oldCount = builder.header.oldCount
    , newStart = builder.header.newStart
    , newCount = builder.header.newCount
    , lines = List.reverse builder.lines
    }


appendLine : String -> Builder -> Builder
appendLine raw builder =
    case String.uncons raw of
        Just ( '+', value ) ->
            { builder
                | newLine = builder.newLine + 1
                , lines = AddedLine { new = builder.newLine, text = value } :: builder.lines
            }

        Just ( '-', value ) ->
            { builder
                | oldLine = builder.oldLine + 1
                , lines = RemovedLine { old = builder.oldLine, text = value } :: builder.lines
            }

        Just ( '\\', _ ) ->
            -- "\ No newline at end of file" annotates the previous line.
            builder

        Just ( ' ', value ) ->
            appendContext value builder

        Just _ ->
            appendContext raw builder

        Nothing ->
            appendContext "" builder


appendContext : String -> Builder -> Builder
appendContext value builder =
    { builder
        | oldLine = builder.oldLine + 1
        , newLine = builder.newLine + 1
        , lines = ContextLine { old = builder.oldLine, new = builder.newLine, text = value } :: builder.lines
    }


{-| Parses `@@ -a[,b] +c[,d] @@`. Git omits a count of one.
-}
hunkHeader : String -> Maybe HunkHeader
hunkHeader raw =
    case String.words raw of
        "@@" :: oldRange :: newRange :: _ ->
            Maybe.map2
                (\( oldStart, oldCount ) ( newStart, newCount ) ->
                    { oldStart = oldStart, oldCount = oldCount, newStart = newStart, newCount = newCount }
                )
                (range "-" oldRange)
                (range "+" newRange)

        _ ->
            Nothing


range : String -> String -> Maybe ( Int, Int )
range marker value =
    if String.startsWith marker value then
        case String.split "," (String.dropLeft 1 value) of
            [ start ] ->
                String.toInt start |> Maybe.map (\number -> ( number, 1 ))

            [ start, count ] ->
                Maybe.map2 Tuple.pair (String.toInt start) (String.toInt count)

            _ ->
                Nothing

    else
        Nothing


{-| Aligns removed and added lines of each change block side by side. When
whitespace is ignored, a pair that differs only in whitespace is dropped.
-}
splitRows : Bool -> Hunk -> List SplitRow
splitRows ignoreWhitespace hunk =
    let
        flushed state =
            zipChanges (List.reverse state.removed) (List.reverse state.added) ++ state.rows

        step line state =
            case line of
                ContextLine context ->
                    { removed = []
                    , added = []
                    , rows =
                        { left = Just { number = context.old, text = context.text, kind = Context }
                        , right = Just { number = context.new, text = context.text, kind = Context }
                        }
                            :: flushed state
                    }

                RemovedLine removed ->
                    if List.isEmpty state.added then
                        { state | removed = { number = removed.old, text = removed.text, kind = Deletion } :: state.removed }

                    else
                        { removed = [ { number = removed.old, text = removed.text, kind = Deletion } ], added = [], rows = flushed state }

                AddedLine added ->
                    { state | added = { number = added.new, text = added.text, kind = Addition } :: state.added }
    in
    List.foldl step { removed = [], added = [], rows = [] } hunk.lines
        |> flushed
        |> List.reverse
        |> List.filter (\row -> not ignoreWhitespace || not (whitespaceOnly row))


{-| Rows in reverse order, so callers can prepend them to a reversed list.
-}
zipChanges : List SideLine -> List SideLine -> List SplitRow
zipChanges removed added =
    let
        paired =
            List.map2 (\left right -> { left = Just left, right = Just right }) removed added

        extraRemoved =
            List.drop (List.length added) removed |> List.map (\left -> { left = Just left, right = Nothing })

        extraAdded =
            List.drop (List.length removed) added |> List.map (\right -> { left = Nothing, right = Just right })
    in
    List.reverse (paired ++ extraRemoved ++ extraAdded)


whitespaceOnly : SplitRow -> Bool
whitespaceOnly row =
    case ( row.left, row.right ) of
        ( Just left, Just right ) ->
            left.kind == Deletion && right.kind == Addition && normalizeWhitespace left.text == normalizeWhitespace right.text

        _ ->
            False


{-| Flattens aligned rows back into unified order: each change block's
removed lines, then its added lines.
-}
unifiedLines : List SplitRow -> List DiffLine
unifiedLines rows =
    let
        -- Every list here is reversed, so the reversed block (removed lines,
        -- then added lines) is the added lines followed by the removed ones.
        flushed state =
            state.added ++ state.removed ++ state.lines

        step row state =
            case ( row.left, row.right ) of
                ( Just left, Just right ) ->
                    if left.kind == Context && right.kind == Context then
                        { removed = [], added = [], lines = ContextLine { old = left.number, new = right.number, text = right.text } :: flushed state }

                    else
                        { state | removed = sideLine left :: state.removed, added = sideLine right :: state.added }

                ( Just left, Nothing ) ->
                    { state | removed = sideLine left :: state.removed }

                ( Nothing, Just right ) ->
                    { state | added = sideLine right :: state.added }

                ( Nothing, Nothing ) ->
                    state
    in
    List.foldl step { removed = [], added = [], lines = [] } rows
        |> flushed
        |> List.reverse


sideLine : SideLine -> DiffLine
sideLine line =
    case line.kind of
        Deletion ->
            RemovedLine { old = line.number, text = line.text }

        Addition ->
            AddedLine { new = line.number, text = line.text }

        Context ->
            -- A context cell without its partner only occurs in full-file
            -- stitching, where both numbers are equal by construction.
            ContextLine { old = line.number, new = line.number, text = line.text }


{-| The whole file with patch hunks stitched in place of their context.
Unread lines are consumed front to back, so stitching is linear in the file.
-}
fullFileRows : Bool -> List Hunk -> String -> String -> List SplitRow
fullFileRows ignoreWhitespace hunks oldText newText =
    let
        numbered text =
            List.indexedMap (\index line -> ( index + 1, line )) (String.lines text)

        before limit =
            span (\( number, _ ) -> number < limit)

        step hunk state =
            let
                -- Git names the line before an insertion when a side's count
                -- is zero, so that side's next unchanged line is one later.
                ( oldContext, oldRest ) =
                    before (hunk.oldStart + zeroRangeOffset hunk.oldCount) state.old

                ( newContext, newRest ) =
                    before (hunk.newStart + zeroRangeOffset hunk.newCount) state.new
            in
            { old = Tuple.second (before (hunk.oldStart + max 1 hunk.oldCount) oldRest)
            , new = Tuple.second (before (hunk.newStart + max 1 hunk.newCount) newRest)
            , rows =
                List.reverse (splitRows ignoreWhitespace hunk)
                    ++ List.reverse (zipContext oldContext newContext)
                    ++ state.rows
            }

        stitched =
            List.foldl step { old = numbered oldText, new = numbered newText, rows = [] } hunks
    in
    List.reverse stitched.rows ++ zipContext stitched.old stitched.new


{-| Splits a list at the first element failing `predicate`.
-}
span : (a -> Bool) -> List a -> ( List a, List a )
span predicate =
    let
        help taken remaining =
            case remaining of
                first :: rest ->
                    if predicate first then
                        help (first :: taken) rest

                    else
                        ( List.reverse taken, remaining )

                [] ->
                    ( List.reverse taken, [] )
    in
    help []


zeroRangeOffset : Int -> Int
zeroRangeOffset count =
    if count == 0 then
        1

    else
        0


zipContext : List ( Int, String ) -> List ( Int, String ) -> List SplitRow
zipContext oldLines newLines =
    let
        cell kind ( number, text ) =
            Just { number = number, text = text, kind = kind }

        paired =
            List.map2 (\old new -> { left = cell Context old, right = cell Context new }) oldLines newLines

        extraOld =
            List.drop (List.length newLines) oldLines |> List.map (\old -> { left = cell Deletion old, right = Nothing })

        extraNew =
            List.drop (List.length oldLines) newLines |> List.map (\new -> { left = Nothing, right = cell Addition new })
    in
    paired ++ extraOld ++ extraNew


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
