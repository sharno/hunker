module Hunker.Domain.Review exposing
    ( AnalysisFeature(..)
    , AnalysisFile
    , AnalysisOptions
    , AnalysisSnapshot
    , AnalysisSnapshotKey
    , CharacterDiff
    , CharacterRange
    , CharacterRow
    , CommentSide(..)
    , FileChange
    , FileStatus(..)
    , FullFile
    , MovedBlock
    , PullCommit
    , ReviewAction(..)
    , ReviewBacking
    , ReviewComment
    , ReviewDocument
    , Revision(..)
    , SemanticChange(..)
    , SemanticResult(..)
    , SourceRange
    , analysisSnapshotDecoder
    , backingBaseOid
    , backingHeadOid
    , backingHeadRef
    , backingLocalPath
    , characterDiffDecoder
    , commentDecoder
    , commentSideToString
    , commentsDecoder
    , commitsDecoder
    , fileStatusToString
    , fullFileDecoder
    , movedBlocksDecoder
    , reviewActionDecoder
    , reviewActionToString
    , reviewDecoder
    , revisionDecoder
    , semanticDecoder
    )

import Dict exposing (Dict)
import Hunker.Domain.Settings as Settings exposing (InlineDiffMode)
import Hunker.Domain.Source as Source exposing (FilePresentation)
import Json.Decode as Decode exposing (Decoder)


type alias FileChange =
    { path : String
    , previousPath : Maybe String
    , status : FileStatus
    , additions : Int
    , deletions : Int
    , patch : String
    }


type FileStatus
    = FileModified
    | FileAdded
    | FileDeleted
    | FileRenamed


type ReviewBacking
    = LocalBacking BackingRevision String
    | GitHubBacking BackingRevision


type alias BackingRevision =
    { baseOid : String
    , headOid : String
    , headRef : String
    }


type alias ReviewDocument =
    { title : String
    , repository : String
    , number : String
    , author : String
    , base : String
    , head : String
    , url : String
    , files : List FileChange
    , backing : ReviewBacking
    }


type alias PullCommit =
    { sha : String
    , message : String
    , author : String
    , avatarUrl : String
    , authoredAt : String
    , htmlUrl : String
    }


type alias SourceRange =
    { startLine : Int
    , endLine : Int
    , startColumn : Int
    , endColumn : Int
    }


type SemanticChange
    = Inserted String String SourceRange Float
    | Deleted String String SourceRange Float
    | Updated String String SourceRange SourceRange Float
    | Renamed String String String SourceRange SourceRange Float


type SemanticResult
    = SemanticParsed String String Bool (List SemanticChange)
    | SemanticUnsupported String String
    | SemanticParseFailed String String String


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
    , confidence : Float
    , changed : Bool
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


type alias CharacterDiff =
    { path : String
    , ignoreWhitespace : Bool
    , mode : InlineDiffMode
    , rows : List CharacterRow
    }


type alias AnalysisOptions =
    { ignoreWhitespace : Bool
    , semantic : Bool
    , syntax : Bool
    , inlineDiff : InlineDiffMode
    }


type alias AnalysisSnapshotKey =
    { repository : String
    , baseOid : String
    , headOid : String
    , options : AnalysisOptions
    }


type alias AnalysisFile =
    { path : String
    , semantic : AnalysisFeature SemanticResult
    , syntax : AnalysisFeature FilePresentation
    , wordDiff : Maybe CharacterDiff
    }


type AnalysisFeature value
    = FeatureDisabled
    | FeatureSkipped String
    | FeatureComplete value


type alias AnalysisSnapshot =
    { key : AnalysisSnapshotKey
    , files : Dict String AnalysisFile
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
    , line : Maybe Int
    , side : CommentSide
    , resolved : Bool
    }


type CommentSide
    = LeftSide
    | RightSide


commentSideToString : CommentSide -> String
commentSideToString side =
    case side of
        LeftSide ->
            "LEFT"

        RightSide ->
            "RIGHT"


type ReviewAction
    = CommentReview
    | ApproveReview
    | RequestChangesReview


reviewActionToString : ReviewAction -> String
reviewActionToString action =
    case action of
        CommentReview ->
            "COMMENT"

        ApproveReview ->
            "APPROVE"

        RequestChangesReview ->
            "REQUEST_CHANGES"


reviewActionDecoder : Decoder ReviewAction
reviewActionDecoder =
    Decode.string
        |> Decode.andThen
            (\value ->
                case value of
                    "COMMENT" ->
                        Decode.succeed CommentReview

                    "APPROVE" ->
                        Decode.succeed ApproveReview

                    "REQUEST_CHANGES" ->
                        Decode.succeed RequestChangesReview

                    _ ->
                        Decode.fail ("Unknown review action: " ++ value)
            )


type Revision
    = GitHubRevision
    | LocalRevision LocalRevisionDetails


type alias LocalRevisionDetails =
    { path : String
    , pinnedHeadOid : String
    , latestHeadOid : String
    , checkedAt : Int
    , current : Bool
    }


reviewDecoder : Decoder ReviewDocument
reviewDecoder =
    Decode.map8
        (\title repository number author base head url files ->
            { title = title
            , repository = repository
            , number = number
            , author = author
            , base = base
            , head = head
            , url = url
            , files = files
            , backing = GitHubBacking { baseOid = "", headOid = "", headRef = "" }
            }
        )
        (Decode.field "title" Decode.string)
        (Decode.field "repository" Decode.string)
        (Decode.field "number" Decode.string)
        (Decode.field "author" Decode.string)
        (Decode.field "base" Decode.string)
        (Decode.field "head" Decode.string)
        (Decode.field "url" Decode.string)
        (Decode.field "files" (Decode.list fileChangeDecoder))
        |> Decode.andThen
            (\partial ->
                Decode.map (\backing -> { partial | backing = backing })
                    (Decode.field "backing" backingDecoder)
            )


backingDecoder : Decoder ReviewBacking
backingDecoder =
    Decode.field "_tag" Decode.string
        |> Decode.andThen
            (\tag ->
                let
                    revision =
                        Decode.map3 BackingRevision
                            (Decode.field "baseOid" Decode.string)
                            (Decode.field "headOid" Decode.string)
                            (Decode.field "headRef" Decode.string)
                in
                case tag of
                    "Local" ->
                        Decode.map2 LocalBacking revision (Decode.field "path" Decode.string)

                    "GitHub" ->
                        Decode.map GitHubBacking revision

                    _ ->
                        Decode.fail ("Unknown review backing: " ++ tag)
            )


fileChangeDecoder : Decoder FileChange
fileChangeDecoder =
    Decode.map6 FileChange
        (Decode.field "path" Decode.string)
        (Decode.field "previousPath" (Decode.nullable Decode.string))
        (Decode.field "status" fileStatusDecoder)
        (Decode.field "additions" Decode.int)
        (Decode.field "deletions" Decode.int)
        (Decode.field "patch" Decode.string)


fileStatusDecoder : Decoder FileStatus
fileStatusDecoder =
    Decode.string
        |> Decode.andThen
            (\value ->
                case value of
                    "modified" ->
                        Decode.succeed FileModified

                    "added" ->
                        Decode.succeed FileAdded

                    "deleted" ->
                        Decode.succeed FileDeleted

                    "renamed" ->
                        Decode.succeed FileRenamed

                    _ ->
                        Decode.fail ("Unknown file status: " ++ value)
            )


fileStatusToString : FileStatus -> String
fileStatusToString status =
    case status of
        FileModified ->
            "modified"

        FileAdded ->
            "added"

        FileDeleted ->
            "deleted"

        FileRenamed ->
            "renamed"


backingRevision : ReviewBacking -> BackingRevision
backingRevision backing =
    case backing of
        LocalBacking revision _ ->
            revision

        GitHubBacking revision ->
            revision


backingBaseOid : ReviewBacking -> String
backingBaseOid =
    backingRevision >> .baseOid


backingHeadOid : ReviewBacking -> String
backingHeadOid =
    backingRevision >> .headOid


backingHeadRef : ReviewBacking -> String
backingHeadRef =
    backingRevision >> .headRef


backingLocalPath : ReviewBacking -> Maybe String
backingLocalPath backing =
    case backing of
        LocalBacking _ path ->
            Just path

        GitHubBacking _ ->
            Nothing


commitsDecoder : Decoder (List PullCommit)
commitsDecoder =
    Decode.field "commits" (Decode.list pullCommitDecoder)


pullCommitDecoder : Decoder PullCommit
pullCommitDecoder =
    Decode.map6 PullCommit
        (Decode.field "sha" Decode.string)
        (Decode.field "message" Decode.string)
        (Decode.field "author" Decode.string)
        (Decode.field "avatarUrl" Decode.string)
        (Decode.field "authoredAt" Decode.string)
        (Decode.field "htmlUrl" Decode.string)


semanticDecoder : Decoder SemanticResult
semanticDecoder =
    Decode.field "_tag" Decode.string
        |> Decode.andThen
            (\tag ->
                case tag of
                    "Parsed" ->
                        Decode.map4 SemanticParsed
                            (Decode.field "path" Decode.string)
                            (Decode.field "language" Decode.string)
                            (Decode.field "semanticEqual" Decode.bool)
                            (Decode.field "changes" (Decode.list semanticChangeDecoder))

                    "Unsupported" ->
                        Decode.map2 SemanticUnsupported
                            (Decode.field "path" Decode.string)
                            (Decode.field "reason" Decode.string)

                    "ParseFailed" ->
                        Decode.map3 SemanticParseFailed
                            (Decode.field "path" Decode.string)
                            (Decode.field "language" Decode.string)
                            (Decode.field "reason" Decode.string)

                    _ ->
                        Decode.fail ("Unknown semantic result: " ++ tag)
            )


semanticChangeDecoder : Decoder SemanticChange
semanticChangeDecoder =
    Decode.field "_tag" Decode.string
        |> Decode.andThen
            (\tag ->
                case tag of
                    "Inserted" ->
                        Decode.map4 Inserted
                            (Decode.field "kind" Decode.string)
                            (Decode.field "label" Decode.string)
                            (Decode.field "newRange" sourceRangeDecoder)
                            (Decode.field "confidence" Decode.float)

                    "Deleted" ->
                        Decode.map4 Deleted
                            (Decode.field "kind" Decode.string)
                            (Decode.field "label" Decode.string)
                            (Decode.field "oldRange" sourceRangeDecoder)
                            (Decode.field "confidence" Decode.float)

                    "Updated" ->
                        Decode.map5 Updated
                            (Decode.field "kind" Decode.string)
                            (Decode.field "label" Decode.string)
                            (Decode.field "oldRange" sourceRangeDecoder)
                            (Decode.field "newRange" sourceRangeDecoder)
                            (Decode.field "confidence" Decode.float)

                    "Renamed" ->
                        Decode.map6 Renamed
                            (Decode.field "kind" Decode.string)
                            (Decode.field "oldLabel" Decode.string)
                            (Decode.field "newLabel" Decode.string)
                            (Decode.field "oldRange" sourceRangeDecoder)
                            (Decode.field "newRange" sourceRangeDecoder)
                            (Decode.field "confidence" Decode.float)

                    _ ->
                        Decode.fail ("Unknown semantic change: " ++ tag)
            )


sourceRangeDecoder : Decoder SourceRange
sourceRangeDecoder =
    Decode.map4 SourceRange
        (Decode.field "startLine" Decode.int)
        (Decode.field "endLine" Decode.int)
        (Decode.field "startColumn" Decode.int)
        (Decode.field "endColumn" Decode.int)


movedBlocksDecoder : Decoder (List MovedBlock)
movedBlocksDecoder =
    Decode.field "moves" (Decode.list movedBlockDecoder)


movedBlockDecoder : Decoder MovedBlock
movedBlockDecoder =
    Decode.map8
        (\fromPath toPath fromLine toLine fromLineCount toLineCount preview kind ->
            { fromPath = fromPath
            , toPath = toPath
            , fromLine = fromLine
            , toLine = toLine
            , fromLineCount = fromLineCount
            , toLineCount = toLineCount
            , preview = preview
            , kind = kind
            , label = ""
            , confidence = 0
            , changed = False
            }
        )
        (Decode.field "fromPath" Decode.string)
        (Decode.field "toPath" Decode.string)
        (Decode.field "fromLine" Decode.int)
        (Decode.field "toLine" Decode.int)
        (Decode.field "fromLineCount" Decode.int)
        (Decode.field "toLineCount" Decode.int)
        (Decode.field "preview" Decode.string)
        (Decode.field "kind" Decode.string)
        |> Decode.andThen
            (\partial ->
                Decode.map3
                    (\label confidence changed ->
                        { partial | label = label, confidence = confidence, changed = changed }
                    )
                    (Decode.field "label" Decode.string)
                    (Decode.field "confidence" Decode.float)
                    (Decode.field "changed" Decode.bool)
            )


characterDiffDecoder : Decoder CharacterDiff
characterDiffDecoder =
    Decode.map4 CharacterDiff
        (Decode.field "path" Decode.string)
        (Decode.field "ignoreWhitespace" Decode.bool)
        (Decode.field "mode" inlineDiffModeDecoder)
        (Decode.field "rows" (Decode.list characterRowDecoder))


analysisSnapshotDecoder : Decoder AnalysisSnapshot
analysisSnapshotDecoder =
    Decode.map3 AnalysisSnapshot
        (Decode.field "key" analysisSnapshotKeyDecoder)
        (Decode.field "files"
            (Decode.list analysisFileDecoder
                |> Decode.map (List.map (\file -> ( file.path, file )) >> Dict.fromList)
            )
        )
        (Decode.field "moves" (Decode.list movedBlockDecoder))


analysisSnapshotKeyDecoder : Decoder AnalysisSnapshotKey
analysisSnapshotKeyDecoder =
    Decode.map4 AnalysisSnapshotKey
        (Decode.field "repository" Decode.string)
        (Decode.field "baseOid" Decode.string)
        (Decode.field "headOid" Decode.string)
        (Decode.field "options" analysisOptionsDecoder)


analysisOptionsDecoder : Decoder AnalysisOptions
analysisOptionsDecoder =
    Decode.map4 AnalysisOptions
        (Decode.field "ignoreWhitespace" Decode.bool)
        (Decode.field "semantic" Decode.bool)
        (Decode.field "syntax" Decode.bool)
        (Decode.field "inlineDiff" inlineDiffModeDecoder)


inlineDiffModeDecoder : Decoder InlineDiffMode
inlineDiffModeDecoder =
    Decode.string
        |> Decode.andThen
            (\value ->
                case value of
                    "token" ->
                        Decode.succeed Settings.Token

                    "character" ->
                        Decode.succeed Settings.Character

                    "off" ->
                        Decode.succeed Settings.InlineOff

                    _ ->
                        Decode.fail ("Unknown inline diff mode: " ++ value)
            )


analysisFileDecoder : Decoder AnalysisFile
analysisFileDecoder =
    Decode.map4 AnalysisFile
        (Decode.field "path" Decode.string)
        (Decode.field "semantic" (analysisFeatureDecoder semanticDecoder))
        (Decode.field "syntax" (analysisFeatureDecoder Source.fileDecoder))
        (Decode.field "wordDiff" (Decode.nullable characterDiffDecoder))


analysisFeatureDecoder : Decoder value -> Decoder (AnalysisFeature value)
analysisFeatureDecoder valueDecoder =
    Decode.field "_tag" Decode.string
        |> Decode.andThen
            (\tag ->
                case tag of
                    "Disabled" ->
                        Decode.succeed FeatureDisabled

                    "Skipped" ->
                        Decode.map FeatureSkipped (Decode.field "reason" Decode.string)

                    "Complete" ->
                        Decode.map FeatureComplete (Decode.field "value" valueDecoder)

                    _ ->
                        Decode.fail ("Unknown analysis feature: " ++ tag)
            )


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
    Decode.map8
        (\id rootId path body author htmlUrl createdAt line ->
            { id = id
            , rootId = rootId
            , path = path
            , body = body
            , author = author
            , htmlUrl = htmlUrl
            , createdAt = createdAt
            , line = line
            , side = RightSide
            , resolved = False
            }
        )
        (Decode.field "id" Decode.int)
        (Decode.field "rootId" Decode.int)
        (Decode.field "path" Decode.string)
        (Decode.field "body" Decode.string)
        (Decode.field "author" Decode.string)
        (Decode.field "htmlUrl" Decode.string)
        (Decode.field "createdAt" Decode.string)
        (Decode.field "line" (Decode.nullable Decode.int))
        |> Decode.andThen
            (\partial ->
                Decode.map2
                    (\side resolved -> { partial | side = side, resolved = resolved })
                    (Decode.field "side" commentSideDecoder)
                    (Decode.field "resolved" Decode.bool)
            )


commentSideDecoder : Decoder CommentSide
commentSideDecoder =
    Decode.string
        |> Decode.andThen
            (\value ->
                case value of
                    "LEFT" ->
                        Decode.succeed LeftSide

                    "RIGHT" ->
                        Decode.succeed RightSide

                    _ ->
                        Decode.fail ("Unknown review comment side: " ++ value)
            )


revisionDecoder : Decoder Revision
revisionDecoder =
    Decode.field "source" Decode.string
        |> Decode.andThen
            (\source ->
                case source of
                    "local" ->
                        Decode.map5
                            (\path pinned latest checked current ->
                                LocalRevision
                                    { path = path
                                    , pinnedHeadOid = pinned
                                    , latestHeadOid = latest
                                    , checkedAt = checked
                                    , current = current
                                    }
                            )
                            (Decode.field "path" Decode.string)
                            (Decode.field "pinnedHeadOid" Decode.string)
                            (Decode.field "latestHeadOid" Decode.string)
                            (Decode.field "checkedAt" Decode.int)
                            (Decode.field "current" Decode.bool)

                    "github" ->
                        Decode.succeed GitHubRevision

                    _ ->
                        Decode.fail ("Unknown revision source: " ++ source)
            )
