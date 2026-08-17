module Hunker.Review.View.DiffPanel exposing (Actions, Layout, LineOptions, fileAnchor, layout, lineOptions, view)

import Dict
import Html exposing (Html, a, article, button, code, div, footer, header, section, span, strong, text)
import Html.Attributes exposing (attribute, class, disabled, href, id, style, type_)
import Html.Events exposing (onClick)
import Hunker.ApiError as ApiError exposing (ApiError)
import Hunker.Diff as Diff exposing (DiffLine, Hunk, Kind(..), SideLine, SplitRow)
import Hunker.Domain.Review as Review exposing (AnalysisFeature(..), CharacterRange, CommentSide(..), FileChange, FileStatus(..), FullFile, ReviewComment, SemanticChange(..), SemanticResult(..))
import Hunker.Domain.Settings exposing (ViewMode(..))
import Hunker.Domain.Source as Source exposing (FilePresentation, FoldRegion, Presentation)
import Hunker.PreparedDiff as PreparedDiff
import Hunker.Remote exposing (Remote(..))
import Hunker.Review.Analysis as Analysis
import Hunker.Review.Collaboration as Collaboration
import Hunker.Review.DiffView as DiffView
import Hunker.Review.FileIndex as FileIndex
import Hunker.Review.Session as Session
import Hunker.Review.View.Collaboration as CollaborationView
import Hunker.SemanticMove as SemanticMove exposing (Endpoint(..))
import Hunker.SourceView as SourceView


type alias Actions msg =
    { toggleFile : String -> msg
    , toggleFullFile : FileChange -> msg
    , toggleReviewed : String -> msg
    , toggleHunk : String -> String -> msg
    , toggleSourceFold : String -> String -> msg
    , selectMoveTarget : String -> String -> msg
    , openInlineComposer : String -> Int -> CommentSide -> msg
    , collaboration : CollaborationView.Actions msg
    }


type alias Config msg =
    { layout : Layout
    , lineOptions : LineOptions
    , analysis : Analysis.Status
    , file : FileIndex.File
    , diff : DiffView.FileState
    , collaboration : Collaboration.FileState
    , githubFileUrl : String
    , actions : Actions msg
    }


type Layout
    = SplitReview
    | SplitReadOnly
    | UnifiedReview
    | UnifiedReadOnly


type LineOptions
    = IgnoreWhitespaceWithSyntax
    | IgnoreWhitespaceWithoutSyntax
    | PreserveWhitespaceWithSyntax
    | PreserveWhitespaceWithoutSyntax


layout : ViewMode -> Bool -> Layout
layout viewMode pullRequest =
    case ( viewMode, pullRequest ) of
        ( Split, True ) ->
            SplitReview

        ( Split, False ) ->
            SplitReadOnly

        ( Unified, True ) ->
            UnifiedReview

        ( Unified, False ) ->
            UnifiedReadOnly


lineOptions : Bool -> Bool -> LineOptions
lineOptions ignoreWhitespace syntaxHighlighting =
    case ( ignoreWhitespace, syntaxHighlighting ) of
        ( True, True ) ->
            IgnoreWhitespaceWithSyntax

        ( True, False ) ->
            IgnoreWhitespaceWithoutSyntax

        ( False, True ) ->
            PreserveWhitespaceWithSyntax

        ( False, False ) ->
            PreserveWhitespaceWithoutSyntax


view : Actions msg -> Layout -> LineOptions -> String -> Analysis.Status -> FileIndex.File -> DiffView.FileState -> Collaboration.FileState -> Html msg
view actions layout_ lineOptions_ githubFileUrl analysis fileModel diff collaboration =
    let
        config =
            { layout = layout_
            , lineOptions = lineOptions_
            , analysis = analysis
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
    article [ class ("diff-panel" ++ activeClass reviewed), id (fileAnchor file.path) ]
        [ header [ class "diff-file-header" ]
            [ button [ type_ "button", class "file-header-main", onClick (config.actions.toggleFile file.path) ]
                [ span [ class "file-collapse" ]
                    [ text
                        (if collapsed then
                            "›"

                         else
                            "⌄"
                        )
                    ]
                , span [ class ("file-status status-" ++ Review.fileStatusToString file.status) ] [ text (statusGlyph file.status) ]
                , strong [] [ text file.path ]
                , file.previousPath
                    |> Maybe.map (\path -> span [ class "previous-path" ] [ text ("from " ++ path) ])
                    |> Maybe.withDefault (text "")
                ]
            , div [ class "file-actions", attribute "data-ignore-file-collapse" "true" ]
                [ button [ type_ "button", disabled (isLoading fullFile), onClick (config.actions.toggleFullFile file) ]
                    [ text
                        (case fullFile of
                            Just (Loading _) ->
                                "Loading…"

                            Just (Success _ _) ->
                                "Patch"

                            _ ->
                                "Full file"
                        )
                    ]
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
                [ semanticSummary config file
                , case fullFile of
                    Just (Success _ full) ->
                        fullFileDiff config file full

                    Just (Failure _ error) ->
                        div [ class "diff-error" ] [ text (ApiError.message error) ]

                    _ ->
                        patchDiff config file
                , CollaborationView.detachedThreads config.actions.collaboration config.collaboration file.path
                , CollaborationView.inlineComposer config.actions.collaboration config.collaboration (fileAnchor file.path) file.path
                , footer [ class "diff-footer" ]
                    [ span [] [ text "End of patch" ]
                    , if isReview config.layout then
                        button [ type_ "button", onClick (config.actions.openInlineComposer file.path (lastNewLine config) RightSide) ] [ text "+ Add a review comment" ]

                      else
                        text ""
                    ]
                ]
        ]


isLoading : Maybe (Remote request error value) -> Bool
isLoading remote =
    case remote of
        Just (Loading _) ->
            True

        _ ->
            False


semanticSummary : Config msg -> FileChange -> Html msg
semanticSummary config file =
    case config.analysis of
        Analysis.AnalysisInFlight ->
            text ""

        Analysis.AnalysisFailure error ->
            text ""

        Analysis.AnalysisComplete ->
            FileIndex.analysis config.file
                |> Maybe.map (.semantic >> semanticFeatureView)
                |> Maybe.withDefault (text "")

        Analysis.AnalysisDisabled ->
            text ""


semanticFeatureView : AnalysisFeature SemanticResult -> Html msg
semanticFeatureView feature =
    case feature of
        FeatureDisabled ->
            text ""

        FeatureSkipped _ ->
            text ""

        FeatureComplete result ->
            semanticResultView result


semanticResultView : SemanticResult -> Html msg
semanticResultView result =
    case result of
        SemanticParsed _ language semanticEqual changes ->
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

        SemanticUnsupported _ _ ->
            text ""

        SemanticParseFailed _ language reason ->
            div [ class "semantic-banner is-error" ] [ strong [] [ text (language ++ " parse failed") ], span [] [ text reason ] ]


semanticChip : SemanticChange -> Html msg
semanticChip change =
    case change of
        Inserted kind label _ _ ->
            span [ class "semantic-chip is-added" ] [ text ("+ " ++ kind ++ " " ++ label) ]

        Deleted kind label _ _ ->
            span [ class "semantic-chip is-deleted" ] [ text ("− " ++ kind ++ " " ++ label) ]

        Updated kind label _ _ _ ->
            span [ class "semantic-chip is-updated" ] [ text ("~ " ++ kind ++ " " ++ label) ]

        Renamed kind oldLabel newLabel _ _ _ ->
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
    div
        [ class
            (if isSplit config.layout then
                "split-diff"

             else
                "unified-diff"
            )
        ]
        (List.map (hunkView config file) (preparedHunks config))


hunkView : Config msg -> FileChange -> Hunk -> Html msg
hunkView config file hunk =
    let
        collapsed =
            DiffView.fileIsHunkCollapsed hunk.id config.diff
    in
    section [ class "diff-hunk" ]
        [ button [ type_ "button", class "hunk-header", onClick (config.actions.toggleHunk file.path hunk.id) ]
            [ span []
                [ text
                    (if collapsed then
                        "›"

                     else
                        "⌄"
                    )
                ]
            , code [] [ text hunk.header ]
            ]
        , if collapsed then
            text ""

          else if isSplit config.layout then
            chunkedLines "split-lines" (List.map (splitRowView config file) (Diff.splitRows (ignoresWhitespace config.lineOptions) hunk))

          else
            chunkedLines "unified-lines" (List.map (unifiedLineView config file) hunk.lines)
        ]


splitRowView : Config msg -> FileChange -> SplitRow -> Html msg
splitRowView config file row =
    splitRowViewWith config file (analysisPresentation config file.path) row


splitRowViewWith : Config msg -> FileChange -> (CommentSide -> Presentation) -> SplitRow -> Html msg
splitRowViewWith config file sourceForSide row =
    div [ class "split-row" ]
        [ splitCell config file LeftSide "left" (sourceForSide LeftSide) row.left
        , splitCell config file RightSide "right" (sourceForSide RightSide) row.right
        ]


splitCell : Config msg -> FileChange -> CommentSide -> String -> Presentation -> Maybe SideLine -> Html msg
splitCell config file side sideClass presentation maybeLine =
    case maybeLine of
        Nothing ->
            div [ class ("split-cell " ++ sideClass ++ " is-empty") ] [ span [ class "line-number" ] [], span [ class "line-marker" ] [], code [ class "line-code" ] [] ]

        Just line ->
            let
                number =
                    Maybe.withDefault 0 line.number

                decoration =
                    moveDecoration config side number

                foldedAway =
                    Source.isLineHidden
                        (\fold -> DiffView.fileIsSourceFoldCollapsed fold config.diff)
                        (sourceNamespace file.path side)
                        number
                        presentation
            in
            if foldedAway then
                div [ class ("split-cell " ++ sideClass ++ " is-empty is-folded-away") ]
                    [ span [ class "line-number" ] [], span [ class "line-marker" ] [], code [ class "line-code" ] [] ]

            else
                div [ class ("split-cell " ++ sideClass ++ " " ++ kindClass line.kind ++ decoration.className), id decoration.anchorId ]
                    [ lineNumberButton config file.path side number line.number
                    , foldMarker config file.path side presentation number line.kind
                    , code [ class "line-code" ]
                        (highlightedLine config file.path side presentation number line.text
                            ++ foldSummary config file.path side presentation number
                        )
                    , decoration.button
                    , CollaborationView.lineThreads config.actions.collaboration config.collaboration file.path side number
                    ]


unifiedLineView : Config msg -> FileChange -> DiffLine -> Html msg
unifiedLineView config file line =
    unifiedLineViewWith config file (analysisPresentation config file.path) line


unifiedLineViewWith : Config msg -> FileChange -> (CommentSide -> Presentation) -> DiffLine -> Html msg
unifiedLineViewWith config file sourceForSide line =
    let
        side =
            if line.kind == Deletion then
                LeftSide

            else
                RightSide

        number =
            if side == LeftSide then
                Maybe.withDefault 0 line.oldLine

            else
                Maybe.withDefault 0 line.newLine

        decoration =
            moveDecoration config side number

        presentation =
            sourceForSide side
    in
    div [ class ("unified-line " ++ kindClass line.kind ++ decoration.className), id decoration.anchorId ]
        [ span [ class "line-number old" ] [ text (maybeNumber line.oldLine) ]
        , lineNumberButton config file.path side number line.newLine
        , foldMarker config file.path side presentation number line.kind
        , code [ class "line-code" ]
            (highlightedLine config file.path side presentation number line.text
                ++ foldSummary config file.path side presentation number
            )
        , decoration.button
        , CollaborationView.lineThreads config.actions.collaboration config.collaboration file.path side number
        ]


type alias MoveDecoration msg =
    { className : String, anchorId : String, button : Html msg }


moveDecoration : Config msg -> CommentSide -> Int -> MoveDecoration msg
moveDecoration config side lineNumber =
    let
        endpoint =
            if side == LeftSide then
                Source

            else
                Destination

        move =
            FileIndex.moveAt endpoint lineNumber config.file
    in
    case move of
        Nothing ->
            { className = "", anchorId = "", button = text "" }

        Just moved ->
            let
                targetEndpoint =
                    if endpoint == Source then
                        Destination

                    else
                        Source

                targetPath =
                    if endpoint == Source then
                        moved.toPath

                    else
                        moved.fromPath
            in
            { className = " line-move move-tone-" ++ String.fromInt (SemanticMove.tone moved)
            , anchorId = SemanticMove.anchor moved endpoint
            , button =
                button
                    [ type_ "button"
                    , class "semantic-move-link"
                    , attribute "title" ("Jump to moved " ++ moved.kind ++ " " ++ moved.label)
                    , onClick (config.actions.selectMoveTarget targetPath (SemanticMove.anchor moved targetEndpoint))
                    ]
                    [ text
                        (if endpoint == Source then
                            "Moved →"

                         else
                            "← From"
                        )
                    ]
            }


lineNumberButton : Config msg -> String -> CommentSide -> Int -> Maybe Int -> Html msg
lineNumberButton config path side number maybeNumberValue =
    if isReview config.layout && maybeNumberValue /= Nothing then
        button [ type_ "button", class "line-number comment-trigger", attribute "title" "Add a GitHub review comment", onClick (config.actions.openInlineComposer path number side) ] [ text (maybeNumber maybeNumberValue) ]

    else
        span [ class "line-number" ] [ text (maybeNumber maybeNumberValue) ]


highlightedLine : Config msg -> String -> CommentSide -> Presentation -> Int -> String -> List (Html msg)
highlightedLine config path side presentation number source =
    SourceView.line
        (showsSyntax config.lineOptions)
        path
        presentation
        number
        source
        (PreparedDiff.rangesFor side number (FileIndex.prepared config.file))


fullFileDiff : Config msg -> FileChange -> FullFile -> Html msg
fullFileDiff config file full =
    let
        rows =
            Diff.fullFileRowsPrepared (preparedHunks config) full.oldText full.newText
    in
    div [ class "full-file-diff" ]
        [ if isSplit config.layout then
            rows
                |> List.filter (fullRowVisible config file.path (fullPresentation full.presentation))
                |> List.map (splitRowViewWith config file (fullPresentation full.presentation))
                |> chunkedLines "split-lines"

          else
            rows
                |> List.concatMap fullUnifiedLines
                |> List.filter (fullLineVisible config file.path (fullPresentation full.presentation))
                |> List.map (unifiedLineViewWith config file (fullPresentation full.presentation))
                |> chunkedLines "unified-lines"
        ]


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
chunksOf size remaining =
    case remaining of
        [] ->
            []

        _ ->
            List.take size remaining :: chunksOf size (List.drop size remaining)


fullRowVisible : Config msg -> String -> (CommentSide -> Presentation) -> SplitRow -> Bool
fullRowVisible config path sourceForSide row =
    [ ( LeftSide, row.left ), ( RightSide, row.right ) ]
        |> List.filterMap
            (\( side, maybeLine ) ->
                maybeLine
                    |> Maybe.andThen .number
                    |> Maybe.map
                        (\number ->
                            not
                                (Source.isLineHidden
                                    (\fold -> DiffView.fileIsSourceFoldCollapsed fold config.diff)
                                    (sourceNamespace path side)
                                    number
                                    (sourceForSide side)
                                )
                        )
            )
        |> List.any identity


fullLineVisible : Config msg -> String -> (CommentSide -> Presentation) -> DiffLine -> Bool
fullLineVisible config path sourceForSide line =
    let
        side =
            if line.kind == Deletion then
                LeftSide

            else
                RightSide

        number =
            if side == LeftSide then
                line.oldLine

            else
                line.newLine
    in
    number
        |> Maybe.map
            (\value ->
                not
                    (Source.isLineHidden
                        (\fold -> DiffView.fileIsSourceFoldCollapsed fold config.diff)
                        (sourceNamespace path side)
                        value
                        (sourceForSide side)
                    )
            )
        |> Maybe.withDefault True


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
                [ text
                    (if collapsed then
                        "›"

                     else
                        "⌄"
                    )
                ]


foldSummary : Config msg -> String -> CommentSide -> Presentation -> Int -> List (Html msg)
foldSummary config path side presentation number =
    Source.foldAt number presentation
        |> Maybe.andThen
            (\fold ->
                if DiffView.fileIsSourceFoldCollapsed (Source.foldKey (sourceNamespace path side) fold) config.diff then
                    Just
                        (span [ class "source-fold-summary" ]
                            [ text (" … " ++ String.fromInt (fold.endLine - fold.startLine) ++ " lines") ]
                        )

                else
                    Nothing
            )
        |> Maybe.map List.singleton
        |> Maybe.withDefault []


sourceNamespace : String -> CommentSide -> String
sourceNamespace path side =
    path
        ++ (case side of
                LeftSide ->
                    ":left"

                RightSide ->
                    ":right"
           )


analysisPresentation : Config msg -> String -> CommentSide -> Presentation
analysisPresentation config path side =
    case config.analysis of
        Analysis.AnalysisComplete ->
            FileIndex.analysis config.file
                |> Maybe.andThen
                    (\analyzed ->
                        case analyzed.syntax of
                            FeatureComplete presentation ->
                                Just (presentationForSide side presentation)

                            _ ->
                                Nothing
                    )
                |> Maybe.withDefault Source.unsupported

        _ ->
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


fullUnifiedLines : SplitRow -> List DiffLine
fullUnifiedLines row =
    case ( row.left, row.right ) of
        ( Just left, Just right ) ->
            if left.kind == Context && right.kind == Context then
                [ { kind = Context, text = right.text, oldLine = left.number, newLine = right.number } ]

            else
                [ { kind = left.kind, text = left.text, oldLine = left.number, newLine = Nothing }
                , { kind = right.kind, text = right.text, oldLine = Nothing, newLine = right.number }
                ]

        ( Just left, Nothing ) ->
            [ { kind = left.kind, text = left.text, oldLine = left.number, newLine = Nothing } ]

        ( Nothing, Just right ) ->
            [ { kind = right.kind, text = right.text, oldLine = Nothing, newLine = right.number } ]

        ( Nothing, Nothing ) ->
            []


preparedHunks : Config msg -> List Hunk
preparedHunks config =
    (FileIndex.prepared config.file).hunks


lastNewLine : Config msg -> Int
lastNewLine config =
    preparedHunks config
        |> List.reverse
        |> List.head
        |> Maybe.andThen (.lines >> List.reverse >> List.filterMap .newLine >> List.head)
        |> Maybe.withDefault 1


statusGlyph : FileStatus -> String
statusGlyph status =
    case status of
        FileAdded ->
            "A"

        FileDeleted ->
            "D"

        FileRenamed ->
            "R"

        FileModified ->
            "M"


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


maybeNumber : Maybe Int -> String
maybeNumber =
    Maybe.map String.fromInt >> Maybe.withDefault ""


fileAnchor : String -> String
fileAnchor path =
    "file-"
        ++ String.map
            (\character ->
                if Char.isAlphaNum character then
                    character

                else
                    '-'
            )
            path


activeClass : Bool -> String
activeClass active =
    if active then
        " is-active"

    else
        ""


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


showsSyntax : LineOptions -> Bool
showsSyntax options =
    case options of
        IgnoreWhitespaceWithSyntax ->
            True

        PreserveWhitespaceWithSyntax ->
            True

        IgnoreWhitespaceWithoutSyntax ->
            False

        PreserveWhitespaceWithoutSyntax ->
            False
