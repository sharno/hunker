module Hunker.Review.View.DiffPanel exposing (Actions, Layout, LineOptions, fileAnchor, layout, lineOptions, view)

import Html exposing (Attribute, Html, a, article, button, code, div, footer, header, section, span, strong, text)
import Html.Attributes exposing (attribute, class, classList, disabled, href, id, style, type_)
import Html.Events exposing (onClick)
import Hunker.ApiError as ApiError
import Hunker.Diff as Diff exposing (DiffLine, Hunk, Kind(..), SideLine, SplitRow)
import Hunker.Domain.Review as Review exposing (AnalysisFeature(..), CommentSide(..), FileChange, FileStatus(..), FullFile, SemanticChange(..), SemanticResult(..))
import Hunker.Domain.Settings exposing (Feature(..), ViewMode(..), Whitespace(..))
import Hunker.Domain.Source as Source exposing (FilePresentation, Presentation)
import Hunker.PreparedDiff as PreparedDiff
import Hunker.Remote exposing (Remote(..))
import Hunker.Review.Collaboration as Collaboration exposing (Anchor)
import Hunker.Review.DiffView as DiffView
import Hunker.Review.FileIndex as FileIndex
import Hunker.Review.View.Collaboration as CollaborationView
import Hunker.SemanticMove as SemanticMove exposing (Endpoint(..))
import Hunker.SourceView as SourceView


type alias Actions msg =
    { toggleFile : String -> msg
    , toggleFullFile : String -> msg
    , toggleReviewed : String -> msg
    , toggleHunk : String -> String -> msg
    , toggleSourceFold : String -> String -> msg
    , selectMoveTarget : String -> String -> msg
    , openInlineComposer : Anchor -> msg
    , collaboration : CollaborationView.Actions msg
    }


type alias Config msg =
    { layout : Layout
    , lineOptions : LineOptions
    , file : FileIndex.File
    , diff : DiffView.FileState
    , collaboration : Collaboration.FileState
    , githubFileUrl : String
    , actions : Actions msg
    }


{-| View mode and review capability as one closed value, so lazy panels
compare a single stable argument.
-}
type Layout
    = SplitReview
    | SplitReadOnly
    | UnifiedReview
    | UnifiedReadOnly


{-| Rendering preferences as one closed value for the same reason.
-}
type LineOptions
    = IgnoreWhitespaceWithSyntax
    | IgnoreWhitespaceWithoutSyntax
    | PreserveWhitespaceWithSyntax
    | PreserveWhitespaceWithoutSyntax


{-| Pull requests accept inline review comments; other reviews are read-only.
-}
layout : ViewMode -> Bool -> Layout
layout viewMode reviewable =
    case ( viewMode, reviewable ) of
        ( Split, True ) ->
            SplitReview

        ( Split, False ) ->
            SplitReadOnly

        ( Unified, True ) ->
            UnifiedReview

        ( Unified, False ) ->
            UnifiedReadOnly


lineOptions : Whitespace -> Feature -> LineOptions
lineOptions whitespace syntax =
    case ( whitespace, syntax ) of
        ( IgnoreWhitespace, Enabled ) ->
            IgnoreWhitespaceWithSyntax

        ( IgnoreWhitespace, Disabled ) ->
            IgnoreWhitespaceWithoutSyntax

        ( ShowWhitespace, Enabled ) ->
            PreserveWhitespaceWithSyntax

        ( ShowWhitespace, Disabled ) ->
            PreserveWhitespaceWithoutSyntax


view : Actions msg -> Layout -> LineOptions -> String -> FileIndex.File -> DiffView.FileState -> Collaboration.FileState -> Html msg
view actions layout_ lineOptions_ githubFileUrl fileModel diff collaboration =
    let
        config =
            { layout = layout_
            , lineOptions = lineOptions_
            , file = fileModel
            , diff = diff
            , collaboration = collaboration
            , githubFileUrl = githubFileUrl
            , actions = actions
            }

        file =
            FileIndex.change fileModel

        collapsed =
            DiffView.fileIsCollapsed config.diff

        fullFile =
            DiffView.fileFullFile config.diff

        reviewed =
            DiffView.fileIsReviewed config.diff
    in
    article [ classList [ ( "diff-panel", True ), ( "is-active", reviewed ) ], id (fileAnchor file.path) ]
        [ header [ class "diff-file-header" ]
            [ button [ type_ "button", class "file-header-main", onClick (config.actions.toggleFile file.path) ]
                [ span [ class "file-collapse" ] [ text (disclosure collapsed) ]
                , span [ class ("file-status status-" ++ Review.fileStatusToString file.status) ] [ text (Review.fileStatusGlyph file.status) ]
                , strong [] [ text file.path ]
                , case file.status of
                    FileRenamed previousPath ->
                        span [ class "previous-path" ] [ text ("from " ++ previousPath) ]

                    FileModified ->
                        text ""

                    FileAdded ->
                        text ""

                    FileDeleted ->
                        text ""
                ]
            , div [ class "file-actions", attribute "data-ignore-file-collapse" "true" ]
                [ fullFileButton config.actions file.path fullFile
                , a [ href config.githubFileUrl, attribute "title" "Open on GitHub" ] [ text "↗" ]
                , button [ type_ "button", onClick (config.actions.toggleReviewed file.path) ]
                    [ text
                        (if reviewed then
                            "Reviewed"

                         else
                            "Mark reviewed"
                        )
                    ]
                ]
            ]
        , if collapsed then
            text ""

          else
            div []
                [ semanticSummary config
                , case fullFile of
                    Success _ full ->
                        fullFileDiff config file full

                    Failure _ error ->
                        div [ class "diff-error" ] [ text (ApiError.message error) ]

                    Loading _ ->
                        patchDiff config file

                    NotAsked ->
                        patchDiff config file
                , CollaborationView.detachedThreads config.actions.collaboration config.collaboration file.path
                , CollaborationView.inlineComposer config.actions.collaboration config.collaboration (fileAnchor file.path) file.path
                , footer [ class "diff-footer" ]
                    [ span [] [ text "End of patch" ]
                    , case ( isReview config.layout, Diff.lastAnchor (preparedHunks config) ) of
                        ( True, Just ( side, line ) ) ->
                            button [ type_ "button", onClick (config.actions.openInlineComposer { path = file.path, line = line, side = commentSide side }) ] [ text "+ Add a review comment" ]

                        ( True, Nothing ) ->
                            text ""

                        ( False, _ ) ->
                            text ""
                    ]
                ]
        ]


fullFileButton : Actions msg -> String -> Remote request error value -> Html msg
fullFileButton actions path fullFile =
    let
        ( label, loading ) =
            case fullFile of
                Loading _ ->
                    ( "Loading…", True )

                Success _ _ ->
                    ( "Patch", False )

                Failure _ _ ->
                    ( "Retry full file", False )

                NotAsked ->
                    ( "Full file", False )
    in
    button [ type_ "button", disabled loading, onClick (actions.toggleFullFile path) ] [ text label ]


disclosure : Bool -> String
disclosure collapsed =
    if collapsed then
        "›"

    else
        "⌄"


commentSide : Diff.Side -> CommentSide
commentSide side =
    case side of
        Diff.OldSide ->
            LeftSide

        Diff.NewSide ->
            RightSide


diffSide : CommentSide -> Diff.Side
diffSide side =
    case side of
        LeftSide ->
            Diff.OldSide

        RightSide ->
            Diff.NewSide


semanticSummary : Config msg -> Html msg
semanticSummary config =
    case FileIndex.analysis config.file |> Maybe.map .semantic of
        Just (FeatureComplete result) ->
            semanticResultView result

        Just (FeatureSkipped _) ->
            text ""

        Just FeatureDisabled ->
            text ""

        Nothing ->
            text ""


semanticResultView : SemanticResult -> Html msg
semanticResultView result =
    case result of
        SemanticParsed language semanticEqual changes ->
            div [ class "semantic-banner" ]
                [ span [ class "semantic-symbol" ] [ text "◎" ]
                , div []
                    [ strong []
                        [ text
                            (if semanticEqual then
                                "Formatting-only semantic change"

                             else
                                semanticCount changes
                            )
                        ]
                    , span [] [ text (language ++ " syntax tree") ]
                    ]
                , div [ class "semantic-chips" ] (List.map semanticChip changes)
                ]

        SemanticUnsupported _ ->
            text ""

        SemanticParseFailed language reason ->
            div [ class "semantic-banner is-error" ] [ strong [] [ text (language ++ " parse failed") ], span [] [ text reason ] ]


semanticChip : SemanticChange -> Html msg
semanticChip change =
    case change of
        Inserted kind label _ ->
            span [ class "semantic-chip is-added" ] [ text ("+ " ++ kind ++ " " ++ label) ]

        Deleted kind label _ ->
            span [ class "semantic-chip is-deleted" ] [ text ("− " ++ kind ++ " " ++ label) ]

        Updated kind label _ _ ->
            span [ class "semantic-chip is-updated" ] [ text ("~ " ++ kind ++ " " ++ label) ]

        Renamed kind oldLabel newLabel _ _ ->
            span [ class "semantic-chip is-renamed" ] [ text (kind ++ " " ++ oldLabel ++ " → " ++ newLabel) ]


semanticCount : List SemanticChange -> String
semanticCount changes =
    String.fromInt (List.length changes)
        ++ " semantic change"
        ++ (if List.length changes == 1 then
                ""

            else
                "s"
           )


patchDiff : Config msg -> FileChange -> Html msg
patchDiff config file =
    div [ class (layoutClass config.layout) ] (List.map (hunkView config file) (preparedHunks config))


layoutClass : Layout -> String
layoutClass layout_ =
    if isSplit layout_ then
        "split-diff"

    else
        "unified-diff"


hunkView : Config msg -> FileChange -> Hunk -> Html msg
hunkView config file hunk =
    let
        collapsed =
            DiffView.fileIsHunkCollapsed hunk.id config.diff

        rows =
            Diff.splitRows (ignoresWhitespace config.lineOptions) hunk

        sourceForSide =
            analysisPresentation config
    in
    section [ class "diff-hunk" ]
        [ button [ type_ "button", class "hunk-header", onClick (config.actions.toggleHunk file.path hunk.id) ]
            [ span [] [ text (disclosure collapsed) ]
            , code [] [ text hunk.header ]
            ]
        , if collapsed then
            text ""

          else if isSplit config.layout then
            chunkedLines "split-lines" (List.map (splitRowView config file sourceForSide) rows)

          else
            chunkedLines "unified-lines" (List.map (unifiedLineView config file sourceForSide) (Diff.unifiedLines rows))
        ]


splitRowView : Config msg -> FileChange -> (CommentSide -> Presentation) -> SplitRow -> Html msg
splitRowView config file sourceForSide row =
    div [ class "split-row" ]
        [ splitCell config file LeftSide "left" (sourceForSide LeftSide) row.left
        , splitCell config file RightSide "right" (sourceForSide RightSide) row.right
        ]


emptyCell : List (Attribute msg) -> Html msg
emptyCell attributes =
    div attributes [ span [ class "line-number" ] [], span [ class "line-marker" ] [], code [ class "line-code" ] [] ]


splitCell : Config msg -> FileChange -> CommentSide -> String -> Presentation -> Maybe SideLine -> Html msg
splitCell config file side sideClass presentation maybeLine =
    case maybeLine of
        Nothing ->
            emptyCell [ class ("split-cell " ++ sideClass ++ " is-empty") ]

        Just line ->
            if isFoldedAway config file.path side line.number presentation then
                emptyCell [ class ("split-cell " ++ sideClass ++ " is-empty is-folded-away") ]

            else
                lineView config
                    file
                    { side = side, number = line.number, kind = line.kind, text = line.text, presentation = presentation }
                    (\decoration -> class ("split-cell " ++ sideClass ++ " " ++ kindClass line.kind ++ decoration))
                    [ lineNumberButton config file.path side line.number ]


type alias RenderedLine =
    { side : CommentSide
    , number : Int
    , kind : Kind
    , text : String
    , presentation : Presentation
    }


{-| The shared body of a split cell and a unified line: gutter, code with
overlays, move link, and the threads anchored to the line.
-}
lineView : Config msg -> FileChange -> RenderedLine -> (String -> Attribute msg) -> List (Html msg) -> Html msg
lineView config file line container gutter =
    let
        move =
            moveDecoration config line.side line.number

        anchorAttributes =
            move |> Maybe.map (\decoration -> [ id decoration.anchorId ]) |> Maybe.withDefault []
    in
    div (container (move |> Maybe.map .className |> Maybe.withDefault "") :: anchorAttributes)
        (gutter
            ++ [ foldMarker config file.path line.side line.presentation line.number line.kind
               , code [ class "line-code" ]
                    (highlightedLine config line.side line.presentation line.number line.text
                        ++ foldSummary config file.path line.side line.presentation line.number
                    )
               , move |> Maybe.map .button |> Maybe.withDefault (text "")
               , CollaborationView.lineThreads config.actions.collaboration config.collaboration file.path line.side line.number
               ]
        )


unifiedLineView : Config msg -> FileChange -> (CommentSide -> Presentation) -> DiffLine -> Html msg
unifiedLineView config file sourceForSide line =
    let
        ( anchorSide, number ) =
            Diff.lineAnchor line

        side =
            commentSide anchorSide

        oldNumber =
            case line of
                Diff.ContextLine context ->
                    String.fromInt context.old

                Diff.RemovedLine removed ->
                    String.fromInt removed.old

                Diff.AddedLine _ ->
                    ""
    in
    lineView config
        file
        { side = side, number = number, kind = Diff.lineKind line, text = Diff.lineText line, presentation = sourceForSide side }
        (\decoration -> class ("unified-line " ++ kindClass (Diff.lineKind line) ++ decoration))
        [ span [ class "line-number old" ] [ text oldNumber ]
        , case line of
            Diff.RemovedLine _ ->
                span [ class "line-number" ] []

            Diff.ContextLine _ ->
                lineNumberButton config file.path side number

            Diff.AddedLine _ ->
                lineNumberButton config file.path side number
        ]


type alias MoveDecoration msg =
    { className : String, anchorId : String, button : Html msg }


moveDecoration : Config msg -> CommentSide -> Int -> Maybe (MoveDecoration msg)
moveDecoration config side lineNumber =
    let
        endpoint =
            case side of
                LeftSide ->
                    Source

                RightSide ->
                    Destination
    in
    FileIndex.moveAt endpoint lineNumber config.file
        |> Maybe.map
            (\moved ->
                let
                    target =
                        SemanticMove.opposite endpoint

                    targetPath =
                        case target of
                            Destination ->
                                moved.toPath

                            Source ->
                                moved.fromPath
                in
                { className = " line-move move-tone-" ++ String.fromInt (SemanticMove.tone moved)
                , anchorId = SemanticMove.anchor moved endpoint
                , button =
                    button
                        [ type_ "button"
                        , class "semantic-move-link"
                        , attribute "title" ("Jump to moved " ++ moved.kind ++ " " ++ moved.label)
                        , onClick (config.actions.selectMoveTarget targetPath (SemanticMove.anchor moved target))
                        ]
                        [ text
                            (case endpoint of
                                Source ->
                                    "Moved →"

                                Destination ->
                                    "← From"
                            )
                        ]
                }
            )


lineNumberButton : Config msg -> String -> CommentSide -> Int -> Html msg
lineNumberButton config path side number =
    if isReview config.layout then
        button
            [ type_ "button"
            , class "line-number comment-trigger"
            , attribute "title" "Add a GitHub review comment"
            , onClick (config.actions.openInlineComposer { path = path, line = number, side = side })
            ]
            [ text (String.fromInt number) ]

    else
        span [ class "line-number" ] [ text (String.fromInt number) ]


highlightedLine : Config msg -> CommentSide -> Presentation -> Int -> String -> List (Html msg)
highlightedLine config side presentation number source =
    SourceView.line
        (showsSyntax config.lineOptions)
        presentation
        number
        source
        (PreparedDiff.rangesFor (diffSide side) number (FileIndex.prepared config.file))


fullFileDiff : Config msg -> FileChange -> FullFile -> Html msg
fullFileDiff config file full =
    let
        rows =
            Diff.fullFileRows (ignoresWhitespace config.lineOptions) (preparedHunks config) full.oldText full.newText

        sourceForSide =
            fullPresentation full.presentation

        visible side number =
            not (isFoldedAway config file.path side number (sourceForSide side))
    in
    div [ class "full-file-diff" ]
        [ if isSplit config.layout then
            rows
                |> List.filter
                    (\row ->
                        List.any identity
                            [ row.left |> Maybe.map (.number >> visible LeftSide) |> Maybe.withDefault False
                            , row.right |> Maybe.map (.number >> visible RightSide) |> Maybe.withDefault False
                            ]
                    )
                |> List.map (splitRowView config file sourceForSide)
                |> chunkedLines "split-lines"

          else
            rows
                |> Diff.unifiedLines
                |> List.filter (\line -> Diff.lineAnchor line |> (\( side, number ) -> visible (commentSide side) number))
                |> List.map (unifiedLineView config file sourceForSide)
                |> chunkedLines "unified-lines"
        ]


{-| Bounded DOM chunks with `content-visibility: auto` defer layout while
keeping every line searchable by native browser Find.
-}
chunkedLines : String -> List (Html msg) -> Html msg
chunkedLines className lines =
    div [ class className ]
        (lines
            |> chunksOf 160
            |> List.map
                (\chunk ->
                    div
                        [ class "diff-line-chunk"
                        , style "contain-intrinsic-block-size"
                            ("auto " ++ String.fromInt (List.length chunk * 28) ++ "px")
                        ]
                        chunk
                )
        )


chunksOf : Int -> List value -> List (List value)
chunksOf size values =
    let
        help remaining chunks =
            case remaining of
                [] ->
                    List.reverse chunks

                _ ->
                    help (List.drop size remaining) (List.take size remaining :: chunks)
    in
    help values []


isFoldedAway : Config msg -> String -> CommentSide -> Int -> Presentation -> Bool
isFoldedAway config path side number presentation =
    Source.isLineHidden
        (\fold -> DiffView.fileIsSourceFoldCollapsed fold config.diff)
        (sourceNamespace path side)
        number
        presentation


foldMarker : Config msg -> String -> CommentSide -> Presentation -> Int -> Kind -> Html msg
foldMarker config path side presentation number kind =
    case Source.foldAt number presentation of
        Nothing ->
            span [ class "line-marker" ] [ text (kindMarker kind) ]

        Just fold ->
            let
                key =
                    Source.foldKey (sourceNamespace path side) fold

                collapsed =
                    DiffView.fileIsSourceFoldCollapsed key config.diff
            in
            button
                [ type_ "button"
                , class "line-marker diff-fold-toggle"
                , attribute "title"
                    ((if collapsed then
                        "Expand "

                      else
                        "Collapse "
                     )
                        ++ fold.label
                    )
                , onClick (config.actions.toggleSourceFold path key)
                ]
                [ text (disclosure collapsed) ]


foldSummary : Config msg -> String -> CommentSide -> Presentation -> Int -> List (Html msg)
foldSummary config path side presentation number =
    case Source.foldAt number presentation of
        Just fold ->
            if DiffView.fileIsSourceFoldCollapsed (Source.foldKey (sourceNamespace path side) fold) config.diff then
                [ span [ class "source-fold-summary" ] [ text (" … " ++ String.fromInt (fold.endLine - fold.startLine) ++ " lines") ] ]

            else
                []

        Nothing ->
            []


sourceNamespace : String -> CommentSide -> String
sourceNamespace path side =
    path
        ++ (case side of
                LeftSide ->
                    ":left"

                RightSide ->
                    ":right"
           )


analysisPresentation : Config msg -> CommentSide -> Presentation
analysisPresentation config side =
    case FileIndex.analysis config.file |> Maybe.map .syntax of
        Just (FeatureComplete presentation) ->
            presentationForSide side presentation

        Just (FeatureSkipped _) ->
            Source.unsupported

        Just FeatureDisabled ->
            Source.unsupported

        Nothing ->
            Source.unsupported


fullPresentation : FilePresentation -> CommentSide -> Presentation
fullPresentation presentation side =
    presentationForSide side presentation


presentationForSide : CommentSide -> FilePresentation -> Presentation
presentationForSide side presentation =
    case side of
        LeftSide ->
            Source.fileOld presentation

        RightSide ->
            Source.fileNew presentation


preparedHunks : Config msg -> List Hunk
preparedHunks config =
    (FileIndex.prepared config.file).hunks


kindClass : Kind -> String
kindClass kind =
    case kind of
        Addition ->
            "addition"

        Deletion ->
            "deletion"

        Context ->
            "context"


kindMarker : Kind -> String
kindMarker kind =
    case kind of
        Addition ->
            "+"

        Deletion ->
            "−"

        Context ->
            " "


{-| A DOM id unique per path: letters and digits are kept and every other
character becomes `-<hex code>-`, so distinct paths never share an id.
-}
fileAnchor : String -> String
fileAnchor path =
    "file-"
        ++ String.concat
            (List.map
                (\character ->
                    if Char.isAlphaNum character then
                        String.fromChar character

                    else
                        "-" ++ hex (Char.toCode character) ++ "-"
                )
                (String.toList path)
            )


hex : Int -> String
hex value =
    let
        digit remainder =
            String.slice remainder (remainder + 1) "0123456789abcdef"

        help remaining digits =
            if remaining < 16 then
                digit remaining ++ digits

            else
                help (remaining // 16) (digit (modBy 16 remaining) ++ digits)
    in
    help value ""


isSplit : Layout -> Bool
isSplit layout_ =
    case layout_ of
        SplitReview ->
            True

        SplitReadOnly ->
            True

        UnifiedReview ->
            False

        UnifiedReadOnly ->
            False


isReview : Layout -> Bool
isReview layout_ =
    case layout_ of
        SplitReview ->
            True

        UnifiedReview ->
            True

        SplitReadOnly ->
            False

        UnifiedReadOnly ->
            False


ignoresWhitespace : LineOptions -> Bool
ignoresWhitespace options =
    case options of
        IgnoreWhitespaceWithSyntax ->
            True

        IgnoreWhitespaceWithoutSyntax ->
            True

        PreserveWhitespaceWithSyntax ->
            False

        PreserveWhitespaceWithoutSyntax ->
            False


showsSyntax : LineOptions -> Feature
showsSyntax options =
    case options of
        IgnoreWhitespaceWithSyntax ->
            Enabled

        PreserveWhitespaceWithSyntax ->
            Enabled

        IgnoreWhitespaceWithoutSyntax ->
            Disabled

        PreserveWhitespaceWithoutSyntax ->
            Disabled
