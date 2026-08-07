module Hunker.Domain.Review exposing
    ( AnalysisFile
    , AnalysisOptions
    , AnalysisSnapshot
    , AnalysisSnapshotKey
    , CharacterDiff
    , CharacterRange
    , CharacterRow
    , FileChange
    , FullFile
    , MovedBlock
    , PullCommit
    , ReviewBacking
    , ReviewComment
    , ReviewData
    , Revision
    , SemanticChange(..)
    , SemanticResult(..)
    , SourceRange
    , analysisSnapshotDecoder
    , characterDiffDecoder
    , commentDecoder
    , commentsDecoder
    , commitsDecoder
    , fileChangesFromDiff
    , fullFileDecoder
    , movedBlocksDecoder
    , reviewDecoder
    , revisionDecoder
    , semanticDecoder
    )

import Dict exposing (Dict)
import Json.Decode as Decode exposing (Decoder)


type alias FileChange =
    { path : String
    , previousPath : String
    , status : String
    , additions : Int
    , deletions : Int
    , patch : String
    }


type alias ReviewBacking =
    { source : String
    , baseOid : String
    , headOid : String
    , headRef : String
    , path : String
    }


type alias ReviewData =
    { title : String
    , repository : String
    , number : String
    , author : String
    , base : String
    , head : String
    , url : String
    , diff : String
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
    , mode : String
    , rows : List CharacterRow
    }


type alias AnalysisOptions =
    { ignoreWhitespace : Bool
    , semantic : Bool
    , inlineDiff : String
    }


type alias AnalysisSnapshotKey =
    { repository : String
    , baseOid : String
    , headOid : String
    , options : AnalysisOptions
    }


type alias AnalysisFile =
    { path : String
    , semantic : Maybe SemanticResult
    , wordDiff : Maybe CharacterDiff
    }


type alias AnalysisSnapshot =
    { key : AnalysisSnapshotKey
    , files : Dict String AnalysisFile
    , moves : List MovedBlock
    }


type alias FullFile =
    { oldText : String
    , newText : String
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
    , side : String
    , resolved : Bool
    }


type alias Revision =
    { source : String
    , path : String
    , pinnedHeadOid : String
    , latestHeadOid : String
    , checkedAt : Int
    , current : Bool
    }


reviewDecoder : Decoder ReviewData
reviewDecoder =
    Decode.map8
        (\title repository number author base head url diff ->
            { title = title
            , repository = repository
            , number = number
            , author = author
            , base = base
            , head = head
            , url = url
            , diff = diff
            , backing = emptyBacking
            }
        )
        (Decode.field "title" Decode.string)
        (Decode.field "repository" Decode.string)
        (Decode.field "number" Decode.string)
        (Decode.field "author" Decode.string)
        (Decode.field "base" Decode.string)
        (Decode.field "head" Decode.string)
        (Decode.field "url" Decode.string)
        (Decode.field "diff" Decode.string)
        |> Decode.andThen
            (\partial ->
                Decode.map (\backing -> { partial | backing = backing })
                    (Decode.field "backing" backingDecoder)
            )


emptyBacking : ReviewBacking
emptyBacking =
    { source = "github", baseOid = "", headOid = "", headRef = "", path = "" }


backingDecoder : Decoder ReviewBacking
backingDecoder =
    Decode.map5 ReviewBacking
        (Decode.field "source" Decode.string)
        (Decode.field "baseOid" Decode.string)
        (Decode.field "headOid" Decode.string)
        (Decode.field "headRef" Decode.string)
        (Decode.field "path" Decode.string)


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
        (Decode.field "mode" Decode.string)
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
    Decode.map3 AnalysisOptions
        (Decode.field "ignoreWhitespace" Decode.bool)
        (Decode.field "semantic" Decode.bool)
        (Decode.field "inlineDiff" Decode.string)


analysisFileDecoder : Decoder AnalysisFile
analysisFileDecoder =
    Decode.map3 AnalysisFile
        (Decode.field "path" Decode.string)
        (Decode.field "semantic" (Decode.nullable semanticDecoder))
        (Decode.field "wordDiff" (Decode.nullable characterDiffDecoder))


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
    Decode.map2 FullFile
        (Decode.field "oldText" Decode.string)
        (Decode.field "newText" Decode.string)


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
            , side = "RIGHT"
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
                    (Decode.field "side" Decode.string)
                    (Decode.field "resolved" Decode.bool)
            )


revisionDecoder : Decoder Revision
revisionDecoder =
    Decode.field "source" Decode.string
        |> Decode.andThen
            (\source ->
                if source == "local" then
                    Decode.map5
                        (\path pinned latest checked current ->
                            { source = source
                            , path = path
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

                else
                    Decode.succeed
                        { source = source
                        , path = ""
                        , pinnedHeadOid = ""
                        , latestHeadOid = ""
                        , checkedAt = 0
                        , current = True
                        }
            )


fileChangesFromDiff : String -> List FileChange
fileChangesFromDiff diff =
    diffChunks diff
        |> List.map parseFileChunk


diffChunks : String -> List String
diffChunks diff =
    let
        finish currentLines completedChunks =
            if List.isEmpty currentLines then
                completedChunks

            else
                (currentLines |> List.reverse |> String.join "\n") :: completedChunks

        step line ( current, completed ) =
            if String.startsWith "diff --git " line then
                ( [ String.dropLeft (String.length "diff --git ") line ]
                , finish current completed
                )

            else if List.isEmpty current then
                ( current, completed )

            else
                ( line :: current, completed )

        ( finalLines, finalChunks ) =
            List.foldl step ( [], [] ) (String.lines diff)
    in
    finish finalLines finalChunks |> List.reverse


parseFileChunk : String -> FileChange
parseFileChunk chunk =
    let
        lines =
            String.lines chunk

        metadata =
            lines |> takeUntil (String.startsWith "@@")

        headerPath =
            lines
                |> List.head
                |> Maybe.andThen
                    (\line ->
                        case String.split " b/" line of
                            _ :: path :: _ ->
                                Just path

                            _ ->
                                Nothing
                    )
                |> Maybe.withDefault "unknown"

        renameFrom =
            prefixedLine "rename from " metadata

        renameTo =
            prefixedLine "rename to " metadata

        patch =
            lines
                |> dropUntil (String.startsWith "@@")
                |> String.join "\n"

        additions =
            patch
                |> String.lines
                |> List.filter (\line -> String.startsWith "+" line && not (String.startsWith "+++" line))
                |> List.length

        deletions =
            patch
                |> String.lines
                |> List.filter (\line -> String.startsWith "-" line && not (String.startsWith "---" line))
                |> List.length
    in
    { path = Maybe.withDefault headerPath renameTo
    , previousPath = Maybe.withDefault "" renameFrom
    , status =
        if List.any (String.startsWith "new file mode") metadata then
            "added"

        else if List.any (String.startsWith "deleted file mode") metadata then
            "deleted"

        else if renameFrom /= Nothing then
            "renamed"

        else
            "modified"
    , additions = additions
    , deletions = deletions
    , patch = patch
    }


prefixedLine : String -> List String -> Maybe String
prefixedLine prefix lines =
    lines
        |> List.filter (String.startsWith prefix)
        |> List.head
        |> Maybe.map (String.dropLeft (String.length prefix))


dropUntil : (value -> Bool) -> List value -> List value
dropUntil predicate values =
    case values of
        [] ->
            []

        first :: rest ->
            if predicate first then
                values

            else
                dropUntil predicate rest


takeUntil : (value -> Bool) -> List value -> List value
takeUntil predicate values =
    case values of
        [] ->
            []

        first :: rest ->
            if predicate first then
                []

            else
                first :: takeUntil predicate rest
