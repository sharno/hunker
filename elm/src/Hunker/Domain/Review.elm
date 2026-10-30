module Hunker.Domain.Review exposing
    ( AnalysisFeature(..)
    , AnalysisFile
    , AnalysisSnapshot
    , CharacterRange
    , CharacterRow
    , CommentAnchor(..)
    , CommentSide(..)
    , FileChange
    , FileStatus(..)
    , FullFile
    , HeadFreshness(..)
    , MovedBlock
    , PullCommit
    , ReviewAction(..)
    , ReviewComment
    , ReviewDocument
    , ReviewRevision
    , ReviewSource(..)
    , Revision(..)
    , SemanticChange(..)
    , SemanticResult(..)
    , SourceRange
    , analysisSnapshotDecoder
    , commentDecoder
    , commentSideToString
    , commentsDecoder
    , commitsDecoder
    , fileStatusGlyph
    , fileStatusToString
    , fullFileDecoder
    , reviewActionDecoder
    , reviewActionToString
    , reviewDecoder
    , revisionDecoder
    )

import Dict exposing (Dict)
import Hunker.Decode exposing (andMap)
import Hunker.Domain.Git as Git exposing (Oid)
import Hunker.Domain.Source as Source exposing (FilePresentation)
import Json.Decode as Decode exposing (Decoder)


type alias FileChange =
    { path : String
    , status : FileStatus
    , additions : Int
    , deletions : Int
    , patch : String
    }


type FileStatus
    = FileModified
    | FileAdded
    | FileDeleted
    | FileRenamed String


type alias ReviewRevision =
    { baseOid : Oid
    , headOid : Oid
    , headRef : String
    }


type ReviewSource
    = LocalSource String
    | GitHubSource


type alias ReviewDocument =
    { title : String
    , author : String
    , base : String
    , head : String
    , files : List FileChange
    , revision : ReviewRevision
    , source : ReviewSource
    }


type alias PullCommit =
    { sha : Oid
    , message : String
    , author : String
    , avatarUrl : Maybe String
    , authoredAt : Maybe String
    , htmlUrl : String
    }


type alias SourceRange =
    { startLine : Int
    , endLine : Int
    , startColumn : Int
    , endColumn : Int
    }


type SemanticChange
    = Inserted String String SourceRange
    | Deleted String String SourceRange
    | Updated String String SourceRange SourceRange
    | Renamed String String String SourceRange SourceRange


type SemanticResult
    = SemanticParsed String Bool (List SemanticChange)
    | SemanticUnsupported String
    | SemanticParseFailed String String


type alias MovedBlock =
    { fromPath : String
    , toPath : String
    , fromLine : Int
    , toLine : Int
    , fromLineCount : Int
    , toLineCount : Int
    , preview : String
    , kind : String
    , label : String
    }


type alias CharacterRange =
    { start : Int
    , end : Int
    }


type alias CharacterRow =
    { oldLine : Maybe Int
    , newLine : Maybe Int
    , oldRanges : List CharacterRange
    , newRanges : List CharacterRange
    }


type alias AnalysisFile =
    { path : String
    , semantic : AnalysisFeature SemanticResult
    , syntax : AnalysisFeature FilePresentation
    , wordDiff : AnalysisFeature (List CharacterRow)
    }


type AnalysisFeature value
    = FeatureDisabled
    | FeatureSkipped String
    | FeatureComplete value


type alias AnalysisSnapshot =
    { files : Dict String AnalysisFile
    , moves : List MovedBlock
    }


type alias FullFile =
    { oldText : String
    , newText : String
    , presentation : FilePresentation
    }


type alias ReviewComment =
    { id : Int
    , rootId : Int
    , path : String
    , body : String
    , author : String
    , htmlUrl : String
    , createdAt : String
    , anchor : CommentAnchor
    , resolved : Bool
    }


{-| Where a review comment sits: on a line of the current diff, on the line it
was written against before later commits moved it, or on the whole file.
-}
type CommentAnchor
    = OnLine CommentSide Int
    | OutdatedLine CommentSide Int
    | OnFile


type CommentSide
    = LeftSide
    | RightSide


type ReviewAction
    = CommentReview
    | ApproveReview
    | RequestChangesReview


{-| Whether the pinned review head is still the pull request's latest head.
-}
type HeadFreshness
    = HeadCurrent
    | HeadBehind Oid


type Revision
    = GitHubRevision
    | LocalRevision { path : String, checkedAt : Int, head : HeadFreshness }


commentSideToString : CommentSide -> String
commentSideToString side =
    case side of
        LeftSide ->
            "LEFT"

        RightSide ->
            "RIGHT"


reviewActionToString : ReviewAction -> String
reviewActionToString action =
    case action of
        CommentReview ->
            "COMMENT"

        ApproveReview ->
            "APPROVE"

        RequestChangesReview ->
            "REQUEST_CHANGES"


fileStatusToString : FileStatus -> String
fileStatusToString status =
    case status of
        FileModified ->
            "modified"

        FileAdded ->
            "added"

        FileDeleted ->
            "deleted"

        FileRenamed _ ->
            "renamed"


fileStatusGlyph : FileStatus -> String
fileStatusGlyph status =
    case status of
        FileAdded ->
            "A"

        FileDeleted ->
            "D"

        FileRenamed _ ->
            "R"

        FileModified ->
            "M"



-- DECODERS


reviewActionDecoder : Decoder ReviewAction
reviewActionDecoder =
    Hunker.Decode.enum "review action"
        (List.map (\action -> ( reviewActionToString action, action )) [ CommentReview, ApproveReview, RequestChangesReview ])


reviewDecoder : Decoder ReviewDocument
reviewDecoder =
    Decode.succeed ReviewDocument
        |> andMap (Decode.field "title" Decode.string)
        |> andMap (Decode.field "author" Decode.string)
        |> andMap (Decode.field "base" Decode.string)
        |> andMap (Decode.field "head" Decode.string)
        |> andMap (Decode.field "files" (Decode.list fileChangeDecoder))
        |> andMap
            (Decode.field "revision"
                (Decode.map3 ReviewRevision
                    (Decode.field "baseOid" Git.oidDecoder)
                    (Decode.field "headOid" Git.oidDecoder)
                    (Decode.field "headRef" Decode.string)
                )
            )
        |> andMap
            (Decode.field "source"
                (Hunker.Decode.tagged "_tag"
                    "review source"
                    [ ( "Local", Decode.map LocalSource (Decode.field "path" Decode.string) )
                    , ( "GitHub", Decode.succeed GitHubSource )
                    ]
                )
            )


fileChangeDecoder : Decoder FileChange
fileChangeDecoder =
    Decode.map5 FileChange
        (Decode.field "path" Decode.string)
        (Hunker.Decode.tagged "status"
            "file status"
            [ ( "modified", Decode.succeed FileModified )
            , ( "added", Decode.succeed FileAdded )
            , ( "deleted", Decode.succeed FileDeleted )
            , ( "renamed", Decode.map FileRenamed (Decode.field "previousPath" Decode.string) )
            ]
        )
        (Decode.field "additions" Decode.int)
        (Decode.field "deletions" Decode.int)
        (Decode.field "patch" Decode.string)


commitsDecoder : Decoder (List PullCommit)
commitsDecoder =
    Decode.field "commits" (Decode.list pullCommitDecoder)


pullCommitDecoder : Decoder PullCommit
pullCommitDecoder =
    Decode.map6 PullCommit
        (Decode.field "sha" Git.oidDecoder)
        (Decode.field "message" Decode.string)
        (Decode.field "author" Decode.string)
        (Decode.field "avatarUrl" (Decode.nullable Decode.string))
        (Decode.field "authoredAt" (Decode.nullable Decode.string))
        (Decode.field "htmlUrl" Decode.string)


semanticDecoder : Decoder SemanticResult
semanticDecoder =
    Hunker.Decode.tagged "_tag"
        "semantic result"
        [ ( "Parsed"
          , Decode.map3 SemanticParsed
                (Decode.field "language" Decode.string)
                (Decode.field "semanticEqual" Decode.bool)
                (Decode.field "changes" (Decode.list semanticChangeDecoder))
          )
        , ( "Unsupported", Decode.map SemanticUnsupported (Decode.field "reason" Decode.string) )
        , ( "ParseFailed"
          , Decode.map2 SemanticParseFailed
                (Decode.field "language" Decode.string)
                (Decode.field "reason" Decode.string)
          )
        ]


semanticChangeDecoder : Decoder SemanticChange
semanticChangeDecoder =
    let
        kind =
            Decode.field "kind" Decode.string

        label =
            Decode.field "label" Decode.string

        oldRange =
            Decode.field "oldRange" sourceRangeDecoder

        newRange =
            Decode.field "newRange" sourceRangeDecoder
    in
    Hunker.Decode.tagged "_tag"
        "semantic change"
        [ ( "Inserted", Decode.map3 Inserted kind label newRange )
        , ( "Deleted", Decode.map3 Deleted kind label oldRange )
        , ( "Updated", Decode.map4 Updated kind label oldRange newRange )
        , ( "Renamed"
          , Decode.map5 Renamed
                kind
                (Decode.field "oldLabel" Decode.string)
                (Decode.field "newLabel" Decode.string)
                oldRange
                newRange
          )
        ]


sourceRangeDecoder : Decoder SourceRange
sourceRangeDecoder =
    Decode.map4 SourceRange
        (Decode.field "startLine" Decode.int)
        (Decode.field "endLine" Decode.int)
        (Decode.field "startColumn" Decode.int)
        (Decode.field "endColumn" Decode.int)


movedBlockDecoder : Decoder MovedBlock
movedBlockDecoder =
    Decode.succeed MovedBlock
        |> andMap (Decode.field "fromPath" Decode.string)
        |> andMap (Decode.field "toPath" Decode.string)
        |> andMap (Decode.field "fromLine" Decode.int)
        |> andMap (Decode.field "toLine" Decode.int)
        |> andMap (Decode.field "fromLineCount" Decode.int)
        |> andMap (Decode.field "toLineCount" Decode.int)
        |> andMap (Decode.field "preview" Decode.string)
        |> andMap (Decode.field "kind" Decode.string)
        |> andMap (Decode.field "label" Decode.string)


analysisSnapshotDecoder : Decoder AnalysisSnapshot
analysisSnapshotDecoder =
    Decode.map2 AnalysisSnapshot
        (Decode.field "files"
            (Decode.list analysisFileDecoder
                |> Decode.map (List.map (\file -> ( file.path, file )) >> Dict.fromList)
            )
        )
        (Decode.field "moves" (Decode.list movedBlockDecoder))


analysisFileDecoder : Decoder AnalysisFile
analysisFileDecoder =
    Decode.map4 AnalysisFile
        (Decode.field "path" Decode.string)
        (Decode.field "semantic" (analysisFeatureDecoder semanticDecoder))
        (Decode.field "syntax" (analysisFeatureDecoder Source.fileDecoder))
        (Decode.field "wordDiff" (analysisFeatureDecoder (Decode.list characterRowDecoder)))


analysisFeatureDecoder : Decoder value -> Decoder (AnalysisFeature value)
analysisFeatureDecoder valueDecoder =
    Hunker.Decode.tagged "_tag"
        "analysis feature"
        [ ( "Disabled", Decode.succeed FeatureDisabled )
        , ( "Skipped", Decode.map FeatureSkipped (Decode.field "reason" Decode.string) )
        , ( "Complete", Decode.map FeatureComplete (Decode.field "value" valueDecoder) )
        ]


characterRowDecoder : Decoder CharacterRow
characterRowDecoder =
    Decode.map4 CharacterRow
        (Decode.field "oldLine" (Decode.nullable Decode.int))
        (Decode.field "newLine" (Decode.nullable Decode.int))
        (Decode.field "oldRanges" (Decode.list characterRangeDecoder))
        (Decode.field "newRanges" (Decode.list characterRangeDecoder))


characterRangeDecoder : Decoder CharacterRange
characterRangeDecoder =
    Decode.map2 CharacterRange
        (Decode.field "start" Decode.int)
        (Decode.field "end" Decode.int)


fullFileDecoder : Decoder FullFile
fullFileDecoder =
    Decode.map3 FullFile
        (Decode.field "oldText" Decode.string)
        (Decode.field "newText" Decode.string)
        (Decode.field "presentation" Source.fileDecoder)


commentsDecoder : Decoder (List ReviewComment)
commentsDecoder =
    Decode.field "comments" (Decode.list commentDecoder)


commentDecoder : Decoder ReviewComment
commentDecoder =
    Decode.succeed ReviewComment
        |> andMap (Decode.field "id" Decode.int)
        |> andMap (Decode.field "rootId" Decode.int)
        |> andMap (Decode.field "path" Decode.string)
        |> andMap (Decode.field "body" Decode.string)
        |> andMap (Decode.field "author" Decode.string)
        |> andMap (Decode.field "htmlUrl" Decode.string)
        |> andMap (Decode.field "createdAt" Decode.string)
        |> andMap (Decode.field "anchor" commentAnchorDecoder)
        |> andMap (Decode.field "resolved" Decode.bool)


commentAnchorDecoder : Decoder CommentAnchor
commentAnchorDecoder =
    let
        side field =
            Decode.field field (Hunker.Decode.enum "review comment side" [ ( "LEFT", LeftSide ), ( "RIGHT", RightSide ) ])
    in
    Hunker.Decode.tagged "_tag"
        "comment anchor"
        [ ( "Current", Decode.map2 OnLine (side "side") (Decode.field "line" Decode.int) )
        , ( "Outdated", Decode.map2 OutdatedLine (side "originalSide") (Decode.field "originalLine" Decode.int) )
        , ( "File", Decode.succeed OnFile )
        ]


revisionDecoder : Decoder Revision
revisionDecoder =
    Hunker.Decode.tagged "source"
        "revision source"
        [ ( "local"
          , Decode.map3 (\path checkedAt head -> LocalRevision { path = path, checkedAt = checkedAt, head = head })
                (Decode.field "path" Decode.string)
                (Decode.field "checkedAt" Decode.int)
                (Decode.field "head"
                    (Hunker.Decode.tagged "_tag"
                        "head freshness"
                        [ ( "Current", Decode.succeed HeadCurrent )
                        , ( "Behind", Decode.map HeadBehind (Decode.field "latestHeadOid" Git.oidDecoder) )
                        ]
                    )
                )
          )
        , ( "github", Decode.succeed GitHubRevision )
        ]
