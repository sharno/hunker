module Hunker.Review.View.DiffPanel exposing (Actions, Config, view)

import Dict
import Html exposing (Html, a, article, button, code, div, footer, header, section, span, strong, text)
import Html.Attributes exposing (attribute, class, href, id, type_)
import Html.Events exposing (onClick)
import Hunker.ApiError as ApiError exposing (ApiError)
import Hunker.Diff as Diff exposing (DiffLine, Hunk, Kind(..), SideLine, SplitRow)
import Hunker.Domain.Review as Review exposing (AnalysisFeature(..), CharacterRange, CommentSide(..), FileChange, FileStatus(..), FullFile, ReviewComment, SemanticChange(..), SemanticResult(..))
import Hunker.Domain.Settings exposing (Settings, ViewMode(..))
import Hunker.PreparedDiff as PreparedDiff
import Hunker.Remote exposing (Remote(..))
import Hunker.Review.Analysis as Analysis
import Hunker.Review.Collaboration as Collaboration
import Hunker.Review.DiffView as DiffView
import Hunker.Review.FileIndex as FileIndex exposing (FileIndex)
import Hunker.Review.Session as Session
import Hunker.Review.View.Collaboration as CollaborationView
import Hunker.SemanticMove as SemanticMove exposing (Endpoint(..))
import Hunker.Syntax as Syntax


type alias Actions msg =
    { toggleFile : String -> msg
    , toggleFullFile : FileChange -> msg
    , toggleReviewed : String -> msg
    , toggleHunk : String -> String -> msg
    , selectMoveTarget : String -> String -> msg
    , openInlineComposer : String -> Int -> CommentSide -> msg
    , collaboration : CollaborationView.Actions msg
    }


type alias Config msg =
    { settings : Settings
    , pullRequest : Bool
    , files : FileIndex
    , analysis : Analysis.State
    , diff : DiffView.Model
    , collaboration : Collaboration.Model
    , comments : Remote Session.Id ApiError (List ReviewComment)
    , githubFileUrl : FileChange -> String
    , actions : Actions msg
    }


view : Config msg -> FileChange -> Html msg
view config file =
    let
        collapsed =
            DiffView.isFileCollapsed file.path config.diff

        fullFile =
            DiffView.fullFile file.path config.diff

        reviewed =
            DiffView.isReviewed file.path config.diff
    in
    article [ class ("diff-panel" ++ activeClass reviewed), id (fileAnchor file.path) ]
        [ header [ class "diff-file-header" ]
            [ button [ type_ "button", class "file-header-main", onClick (config.actions.toggleFile file.path) ]
                [ span [ class "file-collapse" ] [ text (if collapsed then "›" else "⌄") ]
                , span [ class ("file-status status-" ++ Review.fileStatusToString file.status) ] [ text (statusGlyph file.status) ]
                , strong [] [ text file.path ]
                , file.previousPath
                    |> Maybe.map (\path -> span [ class "previous-path" ] [ text ("from " ++ path) ])
                    |> Maybe.withDefault (text "")
                ]
            , div [ class "file-actions", attribute "data-ignore-file-collapse" "true" ]
                [ button [ type_ "button", onClick (config.actions.toggleFullFile file) ]
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
                , a [ href (config.githubFileUrl file), attribute "title" "Open on GitHub" ] [ text "↗" ]
                , button [ type_ "button", onClick (config.actions.toggleReviewed file.path) ] [ text (if reviewed then "Reviewed" else "Mark reviewed") ]
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
                , CollaborationView.detachedThreads config.actions.collaboration config.collaboration config.comments file.path
                , CollaborationView.inlineComposer config.actions.collaboration config.collaboration (fileAnchor file.path) file.path
                , footer [ class "diff-footer" ]
                    [ span [] [ text "End of patch" ]
                    , if config.pullRequest then
                        button [ type_ "button", onClick (config.actions.openInlineComposer file.path (lastNewLine config file.path) RightSide) ] [ text "+ Add a review comment" ]

                      else
                        text ""
                    ]
                ]
        ]


semanticSummary : Config msg -> FileChange -> Html msg
semanticSummary config file =
    if not config.settings.semantic then
        text ""

    else
        case config.analysis of
            Analysis.InFlight _ ->
                div [ class "semantic-banner is-loading" ] [ span [ class "loading-spinner" ] [], text "Analyzing syntax tree…" ]

            Analysis.Failure _ error ->
                div [ class "semantic-banner is-error" ] [ text (ApiError.message error) ]

            Analysis.Complete _ snapshot ->
                snapshot.files
                    |> Dict.get file.path
                    |> Maybe.map (.semantic >> semanticFeatureView)
                    |> Maybe.withDefault (text "")

            Analysis.Disabled ->
                text ""


semanticFeatureView : AnalysisFeature SemanticResult -> Html msg
semanticFeatureView feature =
    case feature of
        FeatureDisabled ->
            text ""

        FeatureSkipped reason ->
            div [ class "semantic-banner is-muted" ] [ strong [] [ text "Syntax analysis skipped" ], span [] [ text reason ] ]

        FeatureComplete result ->
            semanticResultView result


semanticResultView : SemanticResult -> Html msg
semanticResultView result =
    case result of
        SemanticParsed _ language semanticEqual changes ->
            div [ class "semantic-banner" ]
                [ span [ class "semantic-symbol" ] [ text "◎" ]
                , div []
                    [ strong [] [ text (if semanticEqual then "Formatting-only semantic change" else semanticCount changes) ]
                    , span [] [ text (language ++ " syntax tree") ]
                    ]
                , div [ class "semantic-chips" ] (List.map semanticChip changes)
                ]

        SemanticUnsupported _ reason ->
            div [ class "semantic-banner is-muted" ] [ strong [] [ text "Syntax analysis skipped" ], span [] [ text reason ] ]

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
    String.fromInt (List.length changes) ++ " semantic change" ++ (if List.length changes == 1 then "" else "s")


patchDiff : Config msg -> FileChange -> Html msg
patchDiff config file =
    div [ class (if config.settings.viewMode == Split then "split-diff" else "unified-diff") ]
        (List.map (hunkView config file) (preparedHunks config file.path))


hunkView : Config msg -> FileChange -> Hunk -> Html msg
hunkView config file hunk =
    let
        collapsed =
            DiffView.isHunkCollapsed file.path hunk.id config.diff
    in
    section [ class "diff-hunk" ]
        [ button [ type_ "button", class "hunk-header", onClick (config.actions.toggleHunk file.path hunk.id) ]
            [ span [] [ text (if collapsed then "›" else "⌄") ], code [] [ text hunk.header ] ]
        , if collapsed then
            text ""

          else if config.settings.viewMode == Split then
            div [ class "split-lines" ] (List.map (splitRowView config file) (Diff.splitRows config.settings.ignoreWhitespace hunk))

          else
            div [ class "unified-lines" ] (List.map (unifiedLineView config file) hunk.lines)
        ]


splitRowView : Config msg -> FileChange -> SplitRow -> Html msg
splitRowView config file row =
    div [ class "split-row" ]
        [ splitCell config file LeftSide "left" row.left
        , splitCell config file RightSide "right" row.right
        ]


splitCell : Config msg -> FileChange -> CommentSide -> String -> Maybe SideLine -> Html msg
splitCell config file side sideClass maybeLine =
    case maybeLine of
        Nothing ->
            div [ class ("split-cell " ++ sideClass ++ " is-empty") ] [ span [ class "line-number" ] [], span [ class "line-marker" ] [], code [ class "line-code" ] [] ]

        Just line ->
            let
                number =
                    Maybe.withDefault 0 line.number

                decoration =
                    moveDecoration config file.path side number
            in
            div [ class ("split-cell " ++ sideClass ++ " " ++ kindClass line.kind ++ decoration.className), id decoration.anchorId ]
                [ lineNumberButton config file.path side number line.number
                , span [ class "line-marker" ] [ text (kindMarker line.kind) ]
                , code [ class "line-code" ] (highlightedLine config file.path side number line.text)
                , decoration.button
                , CollaborationView.lineThreads config.actions.collaboration config.collaboration config.comments file.path side number
                ]


unifiedLineView : Config msg -> FileChange -> DiffLine -> Html msg
unifiedLineView config file line =
    let
        side =
            if line.kind == Deletion then LeftSide else RightSide

        number =
            if side == LeftSide then Maybe.withDefault 0 line.oldLine else Maybe.withDefault 0 line.newLine

        decoration =
            moveDecoration config file.path side number
    in
    div [ class ("unified-line " ++ kindClass line.kind ++ decoration.className), id decoration.anchorId ]
        [ span [ class "line-number old" ] [ text (maybeNumber line.oldLine) ]
        , lineNumberButton config file.path side number line.newLine
        , span [ class "line-marker" ] [ text (kindMarker line.kind) ]
        , code [ class "line-code" ] (highlightedLine config file.path side number line.text)
        , decoration.button
        , CollaborationView.lineThreads config.actions.collaboration config.collaboration config.comments file.path side number
        ]


type alias MoveDecoration msg =
    { className : String, anchorId : String, button : Html msg }


moveDecoration : Config msg -> String -> CommentSide -> Int -> MoveDecoration msg
moveDecoration config path side lineNumber =
    let
        endpoint =
            if side == LeftSide then Source else Destination

        move =
            case config.analysis of
                Analysis.Complete _ snapshot ->
                    List.filter (SemanticMove.containsLine path lineNumber endpoint) snapshot.moves |> List.head

                _ ->
                    Nothing
    in
    case move of
        Nothing ->
            { className = "", anchorId = "", button = text "" }

        Just moved ->
            let
                targetEndpoint =
                    if endpoint == Source then Destination else Source

                targetPath =
                    if endpoint == Source then moved.toPath else moved.fromPath
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
                    [ text (if endpoint == Source then "Moved →" else "← From") ]
            }


lineNumberButton : Config msg -> String -> CommentSide -> Int -> Maybe Int -> Html msg
lineNumberButton config path side number maybeNumberValue =
    if config.pullRequest && maybeNumberValue /= Nothing then
        button [ type_ "button", class "line-number comment-trigger", attribute "title" "Add a GitHub review comment", onClick (config.actions.openInlineComposer path number side) ] [ text (maybeNumber maybeNumberValue) ]

    else
        span [ class "line-number" ] [ text (maybeNumber maybeNumberValue) ]


highlightedLine : Config msg -> String -> CommentSide -> Int -> String -> List (Html msg)
highlightedLine config path side number source =
    case FileIndex.get path config.files of
        Just prepared ->
            rangedSyntax config.settings.syntaxHighlighting path source (PreparedDiff.rangesFor side number prepared)

        Nothing ->
            Syntax.line config.settings.syntaxHighlighting path source


rangedSyntax : Bool -> String -> String -> List CharacterRange -> List (Html msg)
rangedSyntax syntax path source ranges =
    if List.isEmpty ranges then
        Syntax.line syntax path source

    else
        ranges |> List.sortBy .start |> rangesToSegments 0 source


rangesToSegments : Int -> String -> List CharacterRange -> List (Html msg)
rangesToSegments offset source ranges =
    case ranges of
        [] ->
            [ text (String.dropLeft offset source) ]

        range :: remaining ->
            let
                safeStart = max offset range.start
                safeEnd = max safeStart range.end
            in
            [ text (String.slice offset safeStart source), span [ class "inline-change" ] [ text (String.slice safeStart safeEnd source) ] ]
                ++ rangesToSegments safeEnd source remaining


fullFileDiff : Config msg -> FileChange -> FullFile -> Html msg
fullFileDiff config file full =
    let
        rows =
            Diff.fullFileRowsPrepared (preparedHunks config file.path) full.oldText full.newText
    in
    div [ class "full-file-diff" ]
        (if config.settings.viewMode == Split then
            List.map (splitRowView config file) rows

         else
            rows |> List.concatMap fullUnifiedLines |> List.map (unifiedLineView config file)
        )


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


preparedHunks : Config msg -> String -> List Hunk
preparedHunks config path =
    FileIndex.hunks path config.files


lastNewLine : Config msg -> String -> Int
lastNewLine config path =
    preparedHunks config path
        |> List.reverse
        |> List.head
        |> Maybe.andThen (.lines >> List.reverse >> List.filterMap .newLine >> List.head)
        |> Maybe.withDefault 1


statusGlyph : FileStatus -> String
statusGlyph status =
    case status of
        FileAdded -> "A"
        FileDeleted -> "D"
        FileRenamed -> "R"
        FileModified -> "M"


kindClass : Kind -> String
kindClass kind =
    case kind of
        Addition -> "addition"
        Deletion -> "deletion"
        Context -> "context"


kindMarker : Kind -> String
kindMarker kind =
    case kind of
        Addition -> "+"
        Deletion -> "−"
        Context -> " "


maybeNumber : Maybe Int -> String
maybeNumber =
    Maybe.map String.fromInt >> Maybe.withDefault ""


fileAnchor : String -> String
fileAnchor path =
    "file-" ++ String.map (\character -> if Char.isAlphaNum character then character else '-') path


activeClass : Bool -> String
activeClass active =
    if active then " is-active" else ""
