module Hunker.Repository.View.Commits exposing (Config, State(..), view)

import Html exposing (Html, button, code, div, h2, header, p, section, span, strong, text)
import Html.Attributes exposing (class, type_)
import Html.Events exposing (onClick)
import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Git as Git
import Hunker.Domain.Repository exposing (Commit, Commits, History(..))
import Hunker.Remote exposing (Remote(..))
import Hunker.Repository.View.Local as Local


type alias Config identity msg =
    { state : State identity msg
    , reference : Maybe String
    , selectedCommit : Commit -> msg
    }


type State identity msg
    = LocalUnavailable (Local.Unavailable msg)
    | CommitsRemote (Remote identity ApiError Commits)


view : Config identity msg -> Html msg
view config =
    case config.state of
        LocalUnavailable unavailable ->
            Local.viewUnavailable unavailable

        CommitsRemote remote ->
            case remote of
                Loading _ ->
                    Local.pageState "Loading commits…" "Reading immutable OIDs from the local checkout."

                Failure _ error ->
                    Local.errorState "Could not load commits" error

                Success _ data ->
                    section [ class "commits-browser repository-commits-browser" ]
                        [ header [ class "commits-heading" ]
                            [ div [] [ h2 [] [ text ("Commits on " ++ Maybe.withDefault (Git.oidToString data.ref) config.reference) ], p [] [ text "Select an immutable commit to open its diff." ] ]
                            , span []
                                [ text
                                    (String.fromInt (List.length data.commits)
                                        ++ (case data.history of
                                                ShallowHistory ->
                                                    " · shallow"

                                                CompleteHistory ->
                                                    ""
                                           )
                                    )
                                ]
                            ]
                        , div [ class "commit-list" ] (List.map (rowView config.selectedCommit) data.commits)
                        ]

                NotAsked ->
                    Local.pageState "Loading commits…" "Reading immutable OIDs from the local checkout."


rowView : (Commit -> msg) -> Commit -> Html msg
rowView selectedCommit commit =
    button [ type_ "button", class "commit-row repository-commit-row", onClick (selectedCommit commit) ]
        [ span [ class "commit-avatar" ] [ text (String.left 2 (String.toUpper commit.authorName)) ]
        , span [ class "commit-copy" ]
            [ strong [] [ text commit.subject ]
            , span [] [ text (commit.authorName ++ " · " ++ commit.authoredAt) ]
            ]
        , span [ class "commit-action" ]
            [ code [ class "commit-sha" ] [ text (String.left 7 (Git.oidToString commit.sha)) ]
            , span [ class "commit-open-arrow" ] [ text "→" ]
            ]
        ]
